package route

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var routeDBCounter int64

// adminUser 返回请求上下文中的管理员用户（RequireAdmin 门禁用）。
func adminUser() *models.User {
	return &models.User{
		ID: "u1", Username: "admin", DisplayName: "系统管理员",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleAdmin, Status: models.UserStatusActive,
	}
}

// doJSON 以 JSON 请求体发起请求并返回响应录制器。
func doJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// newRoutesDB 造内存 SQLite，迁移本端点涉及的表（挂载留痕 + 生效产物 + 通知渠道）。
func newRoutesDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:routes_%d?mode=memory&cache=shared", atomic.AddInt64(&routeDBCounter, 1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.AlertmanagerConfigVersion{},
		&models.NotifyChannel{},
		&models.ConfigDraft{},
		&models.ConfigVersion{},
	))
	return db
}

// seedAppliedConfig 写入一条 applied 生效配置留痕（LatestApplied 数据源）。
func seedAppliedConfig(t *testing.T, db *gorm.DB, content string) {
	t.Helper()
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content:   content,
		Checksum:  models.AlertmanagerConfigChecksum(content),
		Status:    models.AlertmanagerConfigStatusApplied,
		AppliedBy: "tester",
	}).Error)
}

// seedWebhookChannel 造一个带出站地址（含敏感路径）的已启用渠道。
func seedWebhookChannel(t *testing.T, db *gorm.DB, name, webhook string) *models.NotifyChannel {
	t.Helper()
	ch := &models.NotifyChannel{
		Name:       name,
		Type:       models.NotifyChannelTypeFeishu,
		WebhookURL: webhook,
	}
	require.NoError(t, db.Create(ch).Error)
	return ch
}

// newRoutesRouter 复刻 register.go 的挂法：GET /routes 仅全局认证（不挂 AuthMiddleware、不挂 RequireAdmin）。
func newRoutesRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/alertmanager")
	g.GET("/routes", ListRoutesHandler(db))
	return r
}

type routesData struct {
	Items         []RouteNode `json:"items"`
	ParseError    string      `json:"parse_error"`
	RawYAML       string         `json:"raw_yaml"`
}

func decodeRoutes(t *testing.T, w *httptest.ResponseRecorder) routesData {
	t.Helper()
	var env struct {
		Status string     `json:"status"`
		Data   routesData `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	require.Equal(t, response.StatusSuccess, env.Status, "body: %s", w.Body.String())
	return env.Data
}

// TestListRoutesHandler_OK：成功渲染路由树。
func TestListRoutesHandler_OK(t *testing.T) {
	db := newRoutesDB(t)
	alpha := seedWebhookChannel(t, db, "alpha", "https://open.feishu.cn/open-apis/bot/v2/hook/SECRETHOOK")
	seedAppliedConfig(t, db, fmt.Sprintf(`
route:
  # 路由名称: 根兜底
  receiver: %s
  routes:
    - receiver: notify-999
`, alpha.ReceiverName()))

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	data := decodeRoutes(t, w)

	require.Len(t, data.Items, 2)
	assert.True(t, data.Items[0].Locked)
	assert.Equal(t, "根兜底", data.Items[0].Name)
}

// TestEffectiveAlertmanagerYAMLHandler_ReturnsEffectiveView 覆盖 C1：GET /config/product 返回
// 「当前生效产品视图」alertmanager.yml（草稿/版本优先于挂载留痕），含平台物化 receivers；
// 前端以此作为 route 保存合并基，仅覆盖 route 段、保留 receivers。
func TestEffectiveAlertmanagerYAMLHandler_ReturnsEffectiveView(t *testing.T) {
	db := newRoutesDB(t)
	seedWebhookChannel(t, db, "SRE 飞书群", "https://open.feishu.cn/hook/SECRET")

	// 挂载留痕（用户手写）：根兜底 user-fallback。
	seedAppliedConfig(t, db, "route:\n  receiver: user-fallback\nreceivers:\n  - name: user-fallback\n")
	// 平台生成产物（产品视图）：根兜底已被接管为 sre，并物化 sre。
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: models.DefaultDomainID,
		DraftID:         "d-1",
		ChangeNo:        "CHG-TEST-C1",
		AlertmanagerYml: "route:\n    receiver: sre\nreceivers:\n    - name: user-fallback\n    - name: sre\n",
	}).Error)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, adminUser()) })
	g := r.Group("/alertmanager/config")
	g.GET("/product", EffectiveAlertmanagerYAMLHandler(db))

	w := doJSON(t, r, http.MethodGet, "/alertmanager/config/product", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var env struct {
		Status string `json:"status"`
		Data   struct {
			YAML string `json:"yaml"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	require.Equal(t, response.StatusSuccess, env.Status)
	assert.Contains(t, env.Data.YAML, "receiver: sre", "须返回产品视图（平台接管后的根兜底），而非挂载留痕")
	assert.Contains(t, env.Data.YAML, "- name: sre", "须包含平台物化的 receivers")
}

// TestListRoutesHandler_NoConfig：无生效配置 → 空 items。
func TestListRoutesHandler_NoConfig(t *testing.T) {
	db := newRoutesDB(t)

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code)
	data := decodeRoutes(t, w)
	assert.Empty(t, data.Items)
}

// TestListRoutes_PrefersGeneratedArtifactOverMountTrace：存在平台生成产物（ConfigVersion）时
// 以产物为准，而非 M08 挂载留痕原文——保证页面根兜底 receiver 与磁盘生效配置一致。
func TestListRoutes_PrefersGeneratedArtifactOverMountTrace(t *testing.T) {
	db := newRoutesDB(t)
	ch := seedWebhookChannel(t, db, "SRE 飞书群", "https://open.feishu.cn/hook/SECRET")

	// M08 挂载留痕原文：根兜底仍是用户手写值，且不含平台物化 receiver。
	seedAppliedConfig(t, db, "route:\n  receiver: user-fallback\nreceivers:\n  - name: user-fallback\n")
	// M09 生成产物：根兜底已被平台接管为 notify-<id>，并物化了该 receiver。
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: models.DefaultDomainID,
		DraftID:         "d-1",
		ChangeNo:        "CHG-TEST-001",
		AlertmanagerYml: fmt.Sprintf("route:\n    receiver: %s\nreceivers:\n    - name: user-fallback\n    - name: %s\n", ch.ReceiverName(), ch.ReceiverName()),
	}).Error)

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	data := decodeRoutes(t, w)

	require.Len(t, data.Items, 1)
	assert.Equal(t, ch.ReceiverName(), data.Items[0].Receiver, "根兜底应取生成产物中被平台接管后的值")
}

// TestListRoutes_PrefersNewerDraftOverVersion：草稿比已确认版本更新时以草稿产物为准，
// 页面反映「即将生效」的路由树。
func TestListRoutes_PrefersNewerDraftOverVersion(t *testing.T) {
	db := newRoutesDB(t)
	ch := seedWebhookChannel(t, db, "SRE 飞书群", "https://open.feishu.cn/hook/SECRET")

	old := time.Now().Add(-time.Hour)
	require.NoError(t, db.Create(&models.ConfigVersion{
		BaseModel:       models.BaseModel{CreatedAt: old},
		NetworkDomainID: models.DefaultDomainID,
		DraftID:         "d-old",
		ChangeNo:        "CHG-TEST-OLD",
		AlertmanagerYml: "route:\n    receiver: " + ch.ReceiverName() + "\n",
	}).Error)
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID:  models.DefaultDomainID,
		ChangeNo:         "CHG-TEST-NEW",
		AlertmanagerYml:   "route:\n    receiver: user-fallback\n",
		Status:           models.DraftStatusPending,
		ValidationStatus: string(models.ValidationStatusPassed),
	}).Error)

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	data := decodeRoutes(t, w)

	require.Len(t, data.Items, 1)
	assert.Equal(t, "user-fallback", data.Items[0].Receiver, "更新的待确认草稿产物优先")
}

// TestListRoutes_IgnoresDiscardedDraft：已废弃草稿不参与产物视图，回落到已确认版本。
func TestListRoutes_IgnoresDiscardedDraft(t *testing.T) {
	db := newRoutesDB(t)
	seedWebhookChannel(t, db, "SRE 飞书群", "https://open.feishu.cn/hook/SECRET")

	require.NoError(t, db.Create(&models.ConfigVersion{
		BaseModel:       models.BaseModel{CreatedAt: time.Now().Add(-time.Hour)},
		NetworkDomainID: models.DefaultDomainID,
		DraftID:         "d-1",
		ChangeNo:        "CHG-TEST-001",
		AlertmanagerYml: "route:\n    receiver: sre\n",
	}).Error)
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID:  models.DefaultDomainID,
		ChangeNo:         "CHG-TEST-DISCARDED",
		AlertmanagerYml:   "route:\n    receiver: stale\n",
		Status:           models.DraftStatusDiscarded,
		ValidationStatus: string(models.ValidationStatusPassed),
	}).Error)

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code)
	data := decodeRoutes(t, w)

	require.Len(t, data.Items, 1)
	assert.Equal(t, "sre", data.Items[0].Receiver, "废弃草稿不参与产物视图")
}

// TestListRoutesHandler_ParseErrorDegradesTo200：解析失败 → 200 + parse_error + raw_yaml（非 500）。
func TestListRoutesHandler_ParseErrorDegradesTo200(t *testing.T) {
	db := newRoutesDB(t)
	broken := "route: [unclosed"
	seedAppliedConfig(t, db, broken)

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code, "解析失败不得落 500：body=%s", w.Body.String())
	data := decodeRoutes(t, w)
	assert.NotEmpty(t, data.ParseError)
	assert.Equal(t, broken, data.RawYAML, "降级为原文只读展示")
	assert.Empty(t, data.Items)
}

// TestListRoutesHandler_AuthOnlyNoWrite：GET 仅全局认证即可访问（无需 admin）；未注册写方法。
func TestListRoutesHandler_AuthOnlyNoWrite(t *testing.T) {
	db := newRoutesDB(t)
	r := newRoutesRouter(db)

	// 未挂 AuthMiddleware / RequireAdmin，仍放行（仅全局认证）。
	w := doJSON(t, r, http.MethodGet, "/alertmanager/routes", "")
	assert.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	// 无写能力：POST /routes 未注册（非 200）。
	w = doJSON(t, r, http.MethodPost, "/alertmanager/routes", `{}`)
	assert.NotEqual(t, http.StatusOK, w.Code, "只读端点不应接受写请求")
}

// TestListRoutesHandler_NoSensitiveValues：响应不回显桥令牌 / 完整出站地址。
func TestListRoutesHandler_NoSensitiveValues(t *testing.T) {
	db := newRoutesDB(t)
	seedWebhookChannel(t, db, "alpha", "https://open.feishu.cn/open-apis/bot/v2/hook/SUPERSECRET")
	seedAppliedConfig(t, db, `
route:
  receiver: alpha
receivers:
  - name: alpha
    webhook_configs:
      - url: https://open.feishu.cn/open-apis/bot/v2/hook/SUPERSECRET
        http_config:
          authorization:
            credentials: BRIDGE_TOKEN_SHOULD_NOT_LEAK
`)

	w := doJSON(t, newRoutesRouter(db), http.MethodGet, "/alertmanager/routes", "")
	require.Equal(t, http.StatusOK, w.Code)
	body := w.Body.String()
	assert.NotContains(t, body, "BRIDGE_TOKEN_SHOULD_NOT_LEAK", "桥令牌不得出现在响应")
	assert.NotContains(t, body, "SUPERSECRET", "出站地址路径（含凭据）必须脱敏")
}