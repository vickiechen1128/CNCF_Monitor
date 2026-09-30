package notify

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestDeriveBridgeBaseURL 覆盖由监听地址推导桥基础地址：通配主机回落回环、显式
// 主机保留、缺端口报错（避免拼出不可达地址）。
func TestDeriveBridgeBaseURL(t *testing.T) {
	cases := []struct {
		name    string
		in      string
		want    string
		wantErr bool
	}{
		{name: "port only", in: ":8080", want: "http://127.0.0.1:8080"},
		{name: "wildcard v4", in: "0.0.0.0:8080", want: "http://127.0.0.1:8080"},
		{name: "wildcard v6", in: "[::]:8080", want: "http://127.0.0.1:8080"},
		{name: "loopback", in: "127.0.0.1:9000", want: "http://127.0.0.1:9000"},
		{name: "explicit host", in: "192.168.1.10:8080", want: "http://192.168.1.10:8080"},
		{name: "localhost", in: "localhost:8080", want: "http://localhost:8080"},
		{name: "missing port", in: "8080", wantErr: true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DeriveBridgeBaseURL(tt.in)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

// TestSanitizeReceiverName 覆盖 receiver 名 sanitize：转小写、非 [a-z0-9] 归一为 -、
// 压缩连续 -、去首尾 -（含中文渠道名用例）。
func TestSanitizeReceiverName(t *testing.T) {
	cases := map[string]string{
		"SRE 飞书群":           "sre",
		"飞书群":               "",
		"Prod--Alerts!!Bot": "prod-alerts-bot",
		"  Feishu  Bot  ":   "feishu-bot",
		"a_b.c@d":           "a-b-c-d",
		"-lead-trail-":      "lead-trail",
		"":                  "",
	}
	for in, want := range cases {
		assert.Equal(t, want, sanitizeReceiverName(in), "input=%q", in)
	}
}

// TestBuildReceiverSnippetUsesRealChannelID 覆盖正常路径：片段含真实数字 channel ID、
// send_resolved: true 与 http_config.authorization（令牌走请求头，H-1），receiver_name
// 由渠道名 sanitize（含中文名）。
func TestBuildReceiverSnippetUsesRealChannelID(t *testing.T) {
	ch := &models.NotifyChannel{
		BaseModel: models.BaseModel{ID: 7},
		Name:      "SRE 飞书群",
		Type:      models.NotifyChannelTypeFeishu,
	}
	cfg := ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "tok-123"}

	got, err := BuildReceiverSnippet(ch, "", cfg)
	require.NoError(t, err)
	assert.Equal(t, "sre", got.ReceiverName)
	assert.True(t, got.TokenConfigured)
	assert.Equal(t, "http://127.0.0.1:8080/api/v1/webhooks/notify?channel=7", got.URL)
	assert.NotContains(t, got.URL, "token", "令牌不得出现在 URL query（H-1）")
	assert.Contains(t, got.Snippet, "  - name: sre\n")
	assert.Contains(t, got.Snippet, "    webhook_configs:\n")
	assert.Contains(t, got.Snippet, "      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?channel=7'\n")
	assert.Contains(t, got.Snippet, "        send_resolved: true\n")
	assert.Contains(t, got.Snippet, "        http_config:\n          authorization:\n            type: Bearer\n            credentials: 'tok-123'\n")
}

// TestBuildReceiverSnippetEmptyNameFallsBack 覆盖渠道名 sanitize 为空时回落 notify-<id>。
func TestBuildReceiverSnippetEmptyNameFallsBack(t *testing.T) {
	ch := &models.NotifyChannel{BaseModel: models.BaseModel{ID: 9}, Name: "飞书群"}
	got, err := BuildReceiverSnippet(ch, "", ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "t"})
	require.NoError(t, err)
	assert.Equal(t, "notify-9", got.ReceiverName)
}

// TestBuildReceiverSnippetNameOverride 覆盖 query receiver_name 覆盖：同样 sanitize，
// sanitize 后为空则报 ErrReceiverNameInvalid。
func TestBuildReceiverSnippetNameOverride(t *testing.T) {
	ch := &models.NotifyChannel{BaseModel: models.BaseModel{ID: 3}, Name: "渠道"}
	cfg := ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "t"}

	got, err := BuildReceiverSnippet(ch, "  My Alerts!! ", cfg)
	require.NoError(t, err)
	assert.Equal(t, "my-alerts", got.ReceiverName)

	_, err = BuildReceiverSnippet(ch, "飞书群", cfg)
	assert.ErrorIs(t, err, ErrReceiverNameInvalid)
}

// TestBuildReceiverSnippetTokenNotConfigured 覆盖令牌未配置：返回 token_configured=false，
// 片段 credentials 使用醒目占位符，绝不伪造令牌；URL 不含任何令牌（H-1）。
func TestBuildReceiverSnippetTokenNotConfigured(t *testing.T) {
	ch := &models.NotifyChannel{BaseModel: models.BaseModel{ID: 4}, Name: "sre"}
	got, err := BuildReceiverSnippet(ch, "", ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080"})
	require.NoError(t, err)
	assert.False(t, got.TokenConfigured)
	assert.Equal(t, "http://127.0.0.1:8080/api/v1/webhooks/notify?channel=4", got.URL)
	assert.NotContains(t, got.URL, "token")
	assert.Contains(t, got.Snippet, "credentials: '"+receiverSnippetTokenPlaceholder+"'")
}

// TestReceiverSnippetURLMatchesBridgeParams 闭环断言：生成 URL 只带 channel 参数、可被
// bridge.go 的 parseUintQuery 解析为真实 ID；令牌由 Authorization 头承载（bearerToken
// 解析口径闭环）。
func TestReceiverSnippetURLMatchesBridgeParams(t *testing.T) {
	ch := &models.NotifyChannel{BaseModel: models.BaseModel{ID: 42}, Name: "sre"}
	got, err := BuildReceiverSnippet(ch, "", ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "tok"})
	require.NoError(t, err)

	u, err := url.Parse(got.URL)
	require.NoError(t, err)
	assert.Equal(t, "/api/v1/webhooks/notify", u.Path)
	q := u.Query()
	id, err := parseUintQuery(q.Get("channel"))
	require.NoError(t, err, "生成的 URL channel 必须能被桥 handler 解析")
	assert.Equal(t, uint(42), id)
	assert.Empty(t, q.Get("token"), "令牌不得入 URL query")

	// 令牌经 Authorization 头承载：AM http_config.authorization 发 Bearer <token>。
	req := httptest.NewRequest(http.MethodPost, got.URL, nil)
	req.Header.Set("Authorization", "Bearer tok")
	assert.Equal(t, "tok", bearerToken(req), "Bearer 解析口径须与片段一致")
}

// --- Handler 层 ---

func snippetPath(id uint) string {
	return "/api/v2/platform/alertmanager/notify-channels/" + strconv.FormatUint(uint64(id), 10) + "/receiver-snippet"
}

func newSnippetRouter(t *testing.T, db *gorm.DB, cfg ReceiverSnippetConfig, u *models.User) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if u != nil {
		user := u
		r.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, user) })
	}
	am := r.Group("/api/v2/platform/alertmanager")
	RegisterRoutes(am, db, cfg)
	return r
}

// TestReceiverSnippetHandlerAuth 覆盖鉴权：无身份 / 普通用户 → 403；管理员 → 200。
func TestReceiverSnippetHandlerAuth(t *testing.T) {
	db := newNotifyDB(t)
	ch, err := CreateChannel(db, ChannelInput{Name: "SRE 飞书群", Type: "feishu", WebhookURL: "https://open.feishu.cn/hook/x"})
	require.NoError(t, err)
	cfg := ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "tok"}

	// 无身份上下文 → 403（片段内嵌令牌属敏感凭据）。
	code, out := doJSON(t, newSnippetRouter(t, db, cfg, nil), http.MethodGet, snippetPath(ch.ID), nil)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out.ErrorType)

	// 普通用户 → 403。
	normal := &models.User{Role: models.UserRoleUser, Status: models.UserStatusActive}
	code, out = doJSON(t, newSnippetRouter(t, db, cfg, normal), http.MethodGet, snippetPath(ch.ID), nil)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out.ErrorType)

	// 管理员 → 200。
	admin := &models.User{Role: models.UserRoleAdmin, Status: models.UserStatusActive}
	code, out = doJSON(t, newSnippetRouter(t, db, cfg, admin), http.MethodGet, snippetPath(ch.ID), nil)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, "sre", out.Data["receiver_name"])
	assert.Equal(t, true, out.Data["token_configured"])
	require.Contains(t, out.Data["url"], "channel="+strconv.FormatUint(uint64(ch.ID), 10))
}

// TestReceiverSnippetHandlerErrors 覆盖 404 / 400 分支。
func TestReceiverSnippetHandlerErrors(t *testing.T) {
	db := newNotifyDB(t)
	admin := &models.User{Role: models.UserRoleAdmin, Status: models.UserStatusActive}
	r := newSnippetRouter(t, db, ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "tok"}, admin)

	// 渠道不存在 → 404 not_found。
	code, out := doJSON(t, r, http.MethodGet, snippetPath(9999), nil)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out.ErrorType)

	// {id} 非法 → 400 bad_request。
	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-channels/abc/receiver-snippet", nil)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)

	code, out = doJSON(t, r, http.MethodGet, "/api/v2/platform/alertmanager/notify-channels/0/receiver-snippet", nil)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)

	// receiver_name 覆盖 sanitize 后为空 → 400。
	ch, err := CreateChannel(db, ChannelInput{Name: "x", Type: "feishu", WebhookURL: "https://open.feishu.cn/h"})
	require.NoError(t, err)
	code, out = doJSON(t, r, http.MethodGet, snippetPath(ch.ID)+"?receiver_name=%E9%A3%9E%E4%B9%A6%E7%BE%A4", nil)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out.ErrorType)
}

// TestReceiverSnippetAcceptedByAmtool 用上游 amtool check-config 实测片段可被接受
// （拼接最小 route: 引用它）。amtool 不可调用时跳过（与设计提案 §3.3.5 校验工序一致）。
func TestReceiverSnippetAcceptedByAmtool(t *testing.T) {
	amtool := locateAmtool(t)
	ch := &models.NotifyChannel{BaseModel: models.BaseModel{ID: 7}, Name: "SRE 飞书群"}

	for _, tc := range []struct {
		name string
		cfg  ReceiverSnippetConfig
	}{
		{name: "token configured", cfg: ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080", BridgeToken: "tok"}},
		{name: "token placeholder", cfg: ReceiverSnippetConfig{BridgeURL: "http://127.0.0.1:8080"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := BuildReceiverSnippet(ch, "", tc.cfg)
			require.NoError(t, err)
			cfgYAML := "route:\n  receiver: " + got.ReceiverName + "\nreceivers:\n" + got.Snippet
			path := filepath.Join(t.TempDir(), "alertmanager.yml")
			require.NoError(t, os.WriteFile(path, []byte(cfgYAML), 0o644))
			out, err := exec.Command(amtool, "check-config", path).CombinedOutput()
			require.NoError(t, err, string(out))
			assert.Contains(t, string(out), "SUCCESS")
		})
	}
}

// locateAmtool 定位 amtool：优先 PATH，其次上游子模块产物；均不可用则跳过。
func locateAmtool(t *testing.T) string {
	t.Helper()
	if p, err := exec.LookPath("amtool"); err == nil {
		return p
	}
	cand, err := filepath.Abs(filepath.Join("..", "..", "..", "upstream", "alertmanager", "amtool"))
	if err == nil {
		if _, statErr := os.Stat(cand); statErr == nil {
			return cand
		}
	}
	t.Skip("amtool 不可调用，跳过接收人片段实测")
	return ""
}
