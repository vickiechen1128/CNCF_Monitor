package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// fakeReceiver 是可脚本化的机器人 webhook 桩服务：记录收到的出站请求体 /
// 目标路径，用于断言平台桥「渲染后转投到已登记渠道」与「绝不转投到请求方地址」。
type fakeReceiver struct {
	mu     sync.Mutex
	bodies [][]byte
	paths  []string
	status int
}

func (f *fakeReceiver) record(path string, body []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.paths = append(f.paths, path)
	f.bodies = append(f.bodies, body)
}

func (f *fakeReceiver) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.bodies)
}

func (f *fakeReceiver) lastBody() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.bodies) == 0 {
		return nil
	}
	return f.bodies[len(f.bodies)-1]
}

func startFakeReceiver(t *testing.T, f *fakeReceiver) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := make([]byte, 0)
		buf := make([]byte, 4096)
		for {
			n, err := r.Body.Read(buf)
			body = append(body, buf[:n]...)
			if err != nil {
				break
			}
		}
		f.record(r.URL.Path, body)
		if f.status != 0 && f.status != http.StatusOK {
			w.WriteHeader(f.status)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// newBridgeRouter 装配桥端点路由（/api/v1/webhooks/notify）。
func newBridgeRouter(db *gorm.DB, cfg BridgeConfig) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	apiV1 := r.Group("/api/v1")
	RegisterBridgeRoutes(apiV1, db, cfg)
	return r
}

// doBridgeJSON 发送带 Bearer 令牌的桥端点 POST（H-1：令牌走 Authorization 头，不落 query）。
// token 为空时不带 Authorization 头（用于「缺失令牌」断言）。
func doBridgeJSON(t *testing.T, r *gin.Engine, path, token string, body interface{}) (int, channelResp) {
	t.Helper()
	var buf bytes.Buffer
	require.NoError(t, json.NewEncoder(&buf).Encode(body))
	req := httptest.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out channelResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

// amBridgePayload 构造 AM 原生 webhook 载荷（camelCase）。
func amBridgePayload(status string) map[string]interface{} {
	return map[string]interface{}{
		"version":           "4",
		"groupKey":          `{}:{alertname="HighCPU"}`,
		"status":            status,
		"receiver":          "sre-critical",
		"groupLabels":       map[string]string{"alertname": "HighCPU"},
		"commonLabels":      map[string]string{"alertname": "HighCPU", "severity": "critical"},
		"commonAnnotations": map[string]string{"summary": "cpu high"},
		"externalURL":       "http://am:9093",
		"alerts": []map[string]interface{}{{
			"status":      status,
			"labels":      map[string]string{"alertname": "HighCPU", "instance": "10.0.0.1:9100", "network_domain_id": "dmz", "severity": "critical"},
			"annotations": map[string]string{"summary": "cpu high", "description": "cpu > 90%"},
			"startsAt":    "2026-01-02T03:04:05Z",
			"endsAt":      "2026-01-02T04:04:05Z",
		}},
	}
}

func mustCreateChannel(t *testing.T, db *gorm.DB, name, chType, url string, enabled bool) *models.NotifyChannel {
	t.Helper()
	ch, err := CreateChannel(db, ChannelInput{Name: name, Type: chType, WebhookURL: url, Enabled: &enabled})
	require.NoError(t, err)
	return ch
}

const bridgeToken = "inner-secret-token"

// --- 鉴权 ---

// TestBridgeRejectsMissingOrWrongToken 未带 / 带错内网令牌一律 401，且不发生任何出站。
func TestBridgeRejectsMissingOrWrongToken(t *testing.T) {
	db := newNotifyDB(t)
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)
	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})
	chID := strconv.FormatUint(uint64(ch.ID), 10)

	// 缺 Authorization 头。
	code, out := doBridgeJSON(t, r, "/api/v1/webhooks/notify?channel="+chID, "", amBridgePayload("firing"))
	assert.Equal(t, http.StatusUnauthorized, code)
	assert.Equal(t, "unauthorized", out.ErrorType)

	// 错令牌。
	code, out = doBridgeJSON(t, r, "/api/v1/webhooks/notify?channel="+chID, "wrong", amBridgePayload("firing"))
	assert.Equal(t, http.StatusUnauthorized, code)
	assert.Equal(t, "unauthorized", out.ErrorType)

	assert.Zero(t, rec.calls(), "鉴权失败不得出站")
}

// --- SSRF 硬约束（核心验收项） ---

// TestBridgeRejectsArbitraryTargetURL 是「传入任意目标 URL 的请求被拒绝」的显式测试：
// 桥端点只接受平台内已登记的 channel ID，任何请求方自带的 / 伪装为 channel 的目标
// 地址都被拒绝，且绝不向攻击者地址出站。
func TestBridgeRejectsArbitraryTargetURL(t *testing.T) {
	db := newNotifyDB(t)
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)
	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})
	chID := strconv.FormatUint(uint64(ch.ID), 10)

	// 1) 额外携带目标地址参数（含用户脚本形态 ?fsurl=）→ 显式拒绝。
	for _, param := range []string{"url", "target", "webhook_url", "fsurl", "to"} {
		code, out := doBridgeJSON(t, r,
			"/api/v1/webhooks/notify?channel="+chID+"&"+param+"=https://evil.example/hook",
			bridgeToken, amBridgePayload("firing"))
		assert.Equalf(t, http.StatusBadRequest, code, "param=%s 应被拒", param)
		assert.Equal(t, "bad_request", out.ErrorType)
		assert.Contains(t, out.Error, "不接受请求方传入的目标地址")
	}

	// 2) 把目标地址伪装成 channel 参数 → 非登记 ID，拒绝。
	code, out := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel=https://evil.example/hook", bridgeToken, amBridgePayload("firing"))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)

	assert.Zero(t, rec.calls(), "任何拒绝对不得产生出站")
}

// TestBridgeChannelNotFound 未登记 / 不存在的 channel → 404，且不出站。
func TestBridgeChannelNotFound(t *testing.T) {
	db := newNotifyDB(t)
	rec := &fakeReceiver{}
	startFakeReceiver(t, rec)
	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})

	code, out := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel=9999", bridgeToken, amBridgePayload("firing"))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Zero(t, rec.calls())
}

// TestBridgeChannelDisabled 禁用的渠道 → 400，且不出站。
func TestBridgeChannelDisabled(t *testing.T) {
	db := newNotifyDB(t)
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, false)
	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})

	code, out := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel="+strconv.FormatUint(uint64(ch.ID), 10),
		bridgeToken, amBridgePayload("firing"))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Zero(t, rec.calls())
}

// --- 渲染 + 转投（happy path） ---

// TestBridgeRendersAndForwardsToRegisteredChannel 覆盖端到端：AM 载荷 → 按内置默认
// 模板渲染 → POST 到 DB 中登记的渠道地址；响应返回 {success, fail}。
func TestBridgeRendersAndForwardsToRegisteredChannel(t *testing.T) {
	db := newNotifyDB(t)
	require.NoError(t, EnsureBuiltinTemplates(db))
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)
	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})

	code, out := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel="+strconv.FormatUint(uint64(ch.ID), 10),
		bridgeToken, amBridgePayload("firing"))
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "success", out.Status)
	assert.EqualValues(t, 1, out.Data["success"])
	assert.EqualValues(t, 0, out.Data["fail"])

	require.Equal(t, 1, rec.calls(), "须向已登记渠道出站一次")
	body := rec.lastBody()
	assert.True(t, json.Valid(body), "出站体须为合法卡片 JSON：%s", string(body))
	s := string(body)
	assert.Contains(t, s, "HighCPU")
	assert.Contains(t, s, "2026-01-02 11:04:05 +08:00", "时间须按东八区本地化")
}

// TestBridgeUsesExplicitTemplate 显式指定同渠道类型的模板时，按其内容渲染。
func TestBridgeUsesExplicitTemplate(t *testing.T) {
	db := newNotifyDB(t)
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)

	tpl := &models.NotifyTemplate{
		Name:        "custom",
		ChannelType: models.NotifyChannelTypeFeishu,
		Content:     `{"msg_type":"text","text":{{ jsonStr (printf "status=%s" .Status) }}}`,
		Checksum:    models.AlertmanagerConfigChecksum("custom"),
		Status:      models.NotifyTemplateStatusApplied,
	}
	require.NoError(t, db.Create(tpl).Error)

	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})
	code, _ := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel="+strconv.FormatUint(uint64(ch.ID), 10)+
			"&template="+strconv.FormatUint(uint64(tpl.ID), 10),
		bridgeToken, amBridgePayload("firing"))
	require.Equal(t, http.StatusOK, code)
	assert.JSONEq(t, `{"msg_type":"text","text":"status=firing"}`, string(rec.lastBody()))
}

// TestBridgeTemplateChannelTypeMismatch 模板适用渠道类型与渠道不一致 → 400，且不出站。
func TestBridgeTemplateChannelTypeMismatch(t *testing.T) {
	db := newNotifyDB(t)
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)

	tpl := &models.NotifyTemplate{
		Name:        "wecom-tpl",
		ChannelType: models.NotifyChannelTypeWecom,
		Content:     `{"x":1}`,
		Checksum:    models.AlertmanagerConfigChecksum("wecom"),
		Status:      models.NotifyTemplateStatusApplied,
	}
	require.NoError(t, db.Create(tpl).Error)

	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})
	code, out := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel="+strconv.FormatUint(uint64(ch.ID), 10)+
			"&template="+strconv.FormatUint(uint64(tpl.ID), 10),
		bridgeToken, amBridgePayload("firing"))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Zero(t, rec.calls())
}

// --- 发送失败可观测，不静默丢失 ---

// TestBridgeSendFailureReturnsBadGateway 渠道不可达 / 返回非 2xx → 502（令 AM 视为
// 投递失败），并记结构化失败日志。
func TestBridgeSendFailureReturnsBadGateway(t *testing.T) {
	db := newNotifyDB(t)
	require.NoError(t, EnsureBuiltinTemplates(db))
	rec := &fakeReceiver{status: http.StatusInternalServerError}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)

	var logs []string
	orig := bridgeLogf
	bridgeLogf = func(format string, args ...interface{}) { logs = append(logs, format) }
	t.Cleanup(func() { bridgeLogf = orig })

	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})
	code, out := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel="+strconv.FormatUint(uint64(ch.ID), 10),
		bridgeToken, amBridgePayload("firing"))
	assert.Equal(t, http.StatusBadGateway, code)
	assert.Equal(t, "bad_gateway", out.ErrorType)
	require.Equal(t, 1, rec.calls())
	assert.Contains(t, logs, "[notify-bridge] send failed channel=%d type=%s template=%d alerts=%d http_status=%d err=%v")
}

// TestBridgeSuccessStructuredLog 成功发送记结构化日志。
func TestBridgeSuccessStructuredLog(t *testing.T) {
	db := newNotifyDB(t)
	require.NoError(t, EnsureBuiltinTemplates(db))
	rec := &fakeReceiver{}
	url := startFakeReceiver(t, rec)
	ch := mustCreateChannel(t, db, "SRE", "feishu", url, true)

	var logs []string
	orig := bridgeLogf
	bridgeLogf = func(format string, args ...interface{}) { logs = append(logs, format) }
	t.Cleanup(func() { bridgeLogf = orig })

	r := newBridgeRouter(db, BridgeConfig{Token: bridgeToken})
	code, _ := doBridgeJSON(t, r,
		"/api/v1/webhooks/notify?channel="+strconv.FormatUint(uint64(ch.ID), 10),
		bridgeToken, amBridgePayload("firing"))
	require.Equal(t, http.StatusOK, code)
	assert.Contains(t, logs, "[notify-bridge] send ok channel=%d type=%s template=%d status=%s alerts=%d")
}

// --- 出站安全（M-1 错误脱敏 / M-3 禁跟随重定向） ---

// TestSanitizeOutboundErrorStripsURL 覆盖 M-1：*url.Error 的完整目标 URL（含 webhook
// token）必须被剥离，仅保留操作名与主机，避免凭据落日志。
func TestSanitizeOutboundErrorStripsURL(t *testing.T) {
	uerr := &url.Error{
		Op:  "Post",
		URL: "https://open.feishu.cn/hook/secret-token-value",
		Err: errors.New("dial tcp: connection refused"),
	}
	got := sanitizeOutboundError(uerr).Error()
	assert.Contains(t, got, "Post")
	assert.Contains(t, got, "open.feishu.cn")
	assert.NotContains(t, got, "secret-token-value", "不得包含完整 URL 中的凭据")
	assert.NotContains(t, got, "/hook/")

	// 非 *url.Error 原样返回。
	plain := errors.New("boom")
	assert.Equal(t, "boom", sanitizeOutboundError(plain).Error())
}

// TestOutboundClientDoesNotFollowRedirects 覆盖 M-3：出站客户端不跟随 3xx（重定向会
// 绕过「目标地址来自 DB 已登记渠道」的约束）。
func TestOutboundClientDoesNotFollowRedirects(t *testing.T) {
	var hits int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		http.Redirect(w, r, "https://evil.example/steal", http.StatusFound)
	}))
	t.Cleanup(target.Close)

	code, err := sendOutbound(context.Background(), target.URL, []byte("{}"))
	// 3xx 视为非 2xx 失败（返回状态码 + 错误），且不跟随重定向。
	assert.Error(t, err)
	assert.Equal(t, http.StatusFound, code, "3xx 应作为最终响应返回，不跟随")
	assert.EqualValues(t, 1, atomic.LoadInt32(&hits), "不得发生二次跳转请求")
}