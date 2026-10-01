package route

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

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

// newRouteDB 造内存 SQLite（复用既有内存 DSN 范式），仅迁移本任务涉及的两张表。
func newRouteDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:route_%d?mode=memory&cache=shared", atomic.AddInt64(&routeDBCounter, 1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.NotifyChannel{}, &models.AlertmanagerRouteSetting{}))
	return db
}

func seedChannel(t *testing.T, db *gorm.DB, name string, enabled bool) *models.NotifyChannel {
	t.Helper()
	ch := &models.NotifyChannel{
		Name:       name,
		Type:       models.NotifyChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/open-apis/bot/v2/hook/x",
		Enabled:    enabled,
	}
	require.NoError(t, db.Create(ch).Error)
	return ch
}

func seedSetting(t *testing.T, db *gorm.DB, channelID *uint) {
	t.Helper()
	require.NoError(t, db.Create(&models.AlertmanagerRouteSetting{
		NetworkDomainID:          models.DefaultDomainID,
		DefaultReceiverChannelID: channelID,
	}).Error)
}

func loadSettingRaw(t *testing.T, db *gorm.DB) *models.AlertmanagerRouteSetting {
	t.Helper()
	var s models.AlertmanagerRouteSetting
	err := db.Where("network_domain_id = ?", models.DefaultDomainID).First(&s).Error
	if err == gorm.ErrRecordNotFound {
		return nil
	}
	require.NoError(t, err)
	return &s
}

// pipelineRecorder 记录写入后闭环工序的调用（trigger + autoApply），断言 Q4 与挂载同构。
type pipelineRecorder struct {
	triggerCalls   int
	autoApplyCalls int
	autoApplyBy    string
}

func stubPipeline(t *testing.T) *pipelineRecorder {
	t.Helper()
	rec := &pipelineRecorder{}
	oldT, oldA := triggerChangeDetection, autoApplyManagementDomain
	triggerChangeDetection = func(db *gorm.DB) error { rec.triggerCalls++; return nil }
	autoApplyManagementDomain = func(db *gorm.DB, by string) error {
		rec.autoApplyCalls++
		rec.autoApplyBy = by
		return nil
	}
	t.Cleanup(func() { triggerChangeDetection = oldT; autoApplyManagementDomain = oldA })
	return rec
}

// newRouteRouter 复刻 register.go 的挂法（GET 仅认证、PUT 挂 RequireAdmin），
// 并在需要时注入已认证用户模拟 AuthMiddleware。
func newRouteRouter(db *gorm.DB, user *models.User) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/alertmanager")
	if user != nil {
		g.Use(func(c *gin.Context) { c.Set(auth.ContextUserKey, user) })
	}
	g.GET("/route-setting", GetRouteSettingHandler(db))
	admin := g.Group("")
	admin.Use(auth.RequireAdmin())
	admin.PUT("/route-setting", PutRouteSettingHandler(db))
	return r
}

func adminUser() *models.User {
	return &models.User{
		ID: "u1", Username: "admin", DisplayName: "系统管理员",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleAdmin, Status: models.UserStatusActive,
	}
}

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

func decodeView(t *testing.T, w *httptest.ResponseRecorder) RouteSettingView {
	t.Helper()
	var env struct {
		Status string           `json:"status"`
		Data   RouteSettingView `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	require.Equal(t, response.StatusSuccess, env.Status, "body: %s", w.Body.String())
	return env.Data
}

// --- 服务层：派生生效态 ---

func TestGetRouteSetting_NoneWhenNoChannelsAndNoSetting(t *testing.T) {
	db := newRouteDB(t)
	view, err := GetRouteSetting(db)
	require.NoError(t, err)
	assert.False(t, view.Enabled)
	assert.Nil(t, view.DefaultReceiverChannelID)
	assert.Equal(t, RouteReceiverSourceNone, view.EffectiveSource)
	assert.Equal(t, "", view.EffectiveReceiverName)
}

func TestGetRouteSetting_AutoFirstEnabledSuggestion(t *testing.T) {
	db := newRouteDB(t)
	seedChannel(t, db, "ignored", false) // id=1 停用，不参与
	seedChannel(t, db, "alpha", true)    // id=2 → 首个已启用
	seedChannel(t, db, "beta", true)     // id=3

	view, err := GetRouteSetting(db)
	require.NoError(t, err)
	assert.False(t, view.Enabled, "未设定默认接收人时平台不接管")
	assert.Nil(t, view.DefaultReceiverChannelID)
	assert.Equal(t, RouteReceiverSourceAutoFirstEnabled, view.EffectiveSource)
	assert.Equal(t, "alpha", view.EffectiveReceiverName, "取已启用渠道按 id 升序第一个")
}

func TestGetRouteSetting_ExplicitWhenChannelAvailable(t *testing.T) {
	db := newRouteDB(t)
	ch := seedChannel(t, db, "primary", true)
	seedSetting(t, db, &ch.ID)

	view, err := GetRouteSetting(db)
	require.NoError(t, err)
	assert.True(t, view.Enabled)
	require.NotNil(t, view.DefaultReceiverChannelID)
	assert.Equal(t, ch.ID, *view.DefaultReceiverChannelID)
	assert.Equal(t, RouteReceiverSourceExplicit, view.EffectiveSource)
	assert.Equal(t, "primary", view.EffectiveReceiverName)
}

func TestGetRouteSetting_NoneWhenTargetChannelDisabled(t *testing.T) {
	db := newRouteDB(t)
	off := seedChannel(t, db, "off", false)
	seedChannel(t, db, "on", true) // 存在其它已启用渠道，但不得回落为 auto_first
	seedSetting(t, db, &off.ID)

	view, err := GetRouteSetting(db)
	require.NoError(t, err)
	assert.False(t, view.Enabled, "显式目标渠道停用 → 回落不接管（护栏③）")
	require.NotNil(t, view.DefaultReceiverChannelID)
	assert.Equal(t, off.ID, *view.DefaultReceiverChannelID, "设定原值保留，不回写库")
	assert.Equal(t, RouteReceiverSourceNone, view.EffectiveSource)
	assert.Equal(t, "", view.EffectiveReceiverName)
}

// --- 服务层：写入 ---

func TestPutRouteSetting_PersistsValidChannel(t *testing.T) {
	db := newRouteDB(t)
	ch1 := seedChannel(t, db, "one", true)
	ch2 := seedChannel(t, db, "two", true)

	require.NoError(t, PutRouteSetting(db, &ch1.ID))
	s := loadSettingRaw(t, db)
	require.NotNil(t, s)
	require.NotNil(t, s.DefaultReceiverChannelID)
	assert.Equal(t, ch1.ID, *s.DefaultReceiverChannelID)

	// 再次写入另一渠道：单例更新，不产生第二行。
	require.NoError(t, PutRouteSetting(db, &ch2.ID))
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerRouteSetting{}).Count(&count).Error)
	assert.Equal(t, int64(1), count)
	s = loadSettingRaw(t, db)
	require.NotNil(t, s.DefaultReceiverChannelID)
	assert.Equal(t, ch2.ID, *s.DefaultReceiverChannelID)
}

func TestPutRouteSetting_NullClosesTakeover(t *testing.T) {
	db := newRouteDB(t)
	ch := seedChannel(t, db, "one", true)
	seedSetting(t, db, &ch.ID)

	require.NoError(t, PutRouteSetting(db, nil))
	s := loadSettingRaw(t, db)
	require.NotNil(t, s, "护栏③：关闭接管保留设定行，仅置空 receiver 判定")
	assert.Nil(t, s.DefaultReceiverChannelID)
}

func TestPutRouteSetting_RejectsMissingChannel(t *testing.T) {
	db := newRouteDB(t)
	missing := uint(999)
	err := PutRouteSetting(db, &missing)
	assert.ErrorIs(t, err, ErrRouteSettingChannelUnavailable)
	assert.Nil(t, loadSettingRaw(t, db), "校验失败不得写入设定")
}

func TestPutRouteSetting_RejectsDisabledChannel(t *testing.T) {
	db := newRouteDB(t)
	ch := seedChannel(t, db, "off", false)
	err := PutRouteSetting(db, &ch.ID)
	assert.ErrorIs(t, err, ErrRouteSettingChannelUnavailable)
	assert.Nil(t, loadSettingRaw(t, db))
}

// --- Handler 层 ---

func TestGetRouteSettingHandler_OK(t *testing.T) {
	db := newRouteDB(t)
	ch := seedChannel(t, db, "primary", true)
	seedSetting(t, db, &ch.ID)

	w := doJSON(t, newRouteRouter(db, nil), http.MethodGet, "/alertmanager/route-setting", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	view := decodeView(t, w)
	assert.True(t, view.Enabled)
	assert.Equal(t, RouteReceiverSourceExplicit, view.EffectiveSource)
	assert.Equal(t, "primary", view.EffectiveReceiverName)
	// 响应不返回桥令牌等敏感值：仅契约字段。
	assert.NotContains(t, w.Body.String(), "token")
	assert.NotContains(t, w.Body.String(), "webhook")
}

func TestPutRouteSettingHandler_ValidChannelInvokesPipeline(t *testing.T) {
	db := newRouteDB(t)
	ch := seedChannel(t, db, "primary", true)
	rec := stubPipeline(t)

	w := doJSON(t, newRouteRouter(db, adminUser()), http.MethodPut, "/alertmanager/route-setting",
		fmt.Sprintf(`{"default_receiver_channel_id":%d}`, ch.ID))
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	view := decodeView(t, w)
	assert.True(t, view.Enabled)
	assert.Equal(t, RouteReceiverSourceExplicit, view.EffectiveSource)
	assert.Equal(t, "primary", view.EffectiveReceiverName)

	// Q4：与挂载同构闭环被触发，操作者取自认证上下文。
	assert.Equal(t, 1, rec.triggerCalls)
	assert.Equal(t, 1, rec.autoApplyCalls)
	assert.Equal(t, "admin", rec.autoApplyBy)

	s := loadSettingRaw(t, db)
	require.NotNil(t, s)
	require.NotNil(t, s.DefaultReceiverChannelID)
	assert.Equal(t, ch.ID, *s.DefaultReceiverChannelID)
}

func TestPutRouteSettingHandler_NullClosesTakeover(t *testing.T) {
	db := newRouteDB(t)
	ch := seedChannel(t, db, "primary", true)
	seedSetting(t, db, &ch.ID)
	rec := stubPipeline(t)

	w := doJSON(t, newRouteRouter(db, adminUser()), http.MethodPut, "/alertmanager/route-setting",
		`{"default_receiver_channel_id":null}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	view := decodeView(t, w)
	assert.False(t, view.Enabled, "关闭接管 → 平台停止替换")
	assert.Nil(t, view.DefaultReceiverChannelID)
	assert.Equal(t, 1, rec.autoApplyCalls)

	s := loadSettingRaw(t, db)
	require.NotNil(t, s)
	assert.Nil(t, s.DefaultReceiverChannelID)
}

func TestPutRouteSettingHandler_BadRequestWhenChannelUnavailable(t *testing.T) {
	db := newRouteDB(t)
	rec := stubPipeline(t)

	w := doJSON(t, newRouteRouter(db, adminUser()), http.MethodPut, "/alertmanager/route-setting",
		`{"default_receiver_channel_id":999}`)
	require.Equal(t, http.StatusBadRequest, w.Code, "body: %s", w.Body.String())

	var env struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	assert.Equal(t, response.StatusError, env.Status)
	assert.Equal(t, response.ErrorTypeBadRequest, env.ErrorType)
	assert.Equal(t, 0, rec.triggerCalls, "校验失败不得触发闭环下发")
}

// TestRouteSetting_AdminGate：PUT 挂 RequireAdmin——缺少认证上下文 / 非 admin → 403；
// GET 仅全局认证（本套未挂 AuthMiddleware，故直接放行）。
func TestRouteSetting_AdminGate(t *testing.T) {
	db := newRouteDB(t)

	// 未认证（无 authUser 上下文）→ 403。
	w := doJSON(t, newRouteRouter(db, nil), http.MethodPut, "/alertmanager/route-setting",
		`{"default_receiver_channel_id":null}`)
	assert.Equal(t, http.StatusForbidden, w.Code, "body: %s", w.Body.String())

	// 已认证普通用户 → 403。
	regular := &models.User{
		ID: "u2", Username: "ops", DisplayName: "普通运维",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleUser, Status: models.UserStatusActive,
	}
	w = doJSON(t, newRouteRouter(db, regular), http.MethodPut, "/alertmanager/route-setting",
		`{"default_receiver_channel_id":null}`)
	assert.Equal(t, http.StatusForbidden, w.Code)

	// GET 仅需全局认证（本套未挂 AuthMiddleware）→ 放行。
	w = doJSON(t, newRouteRouter(db, nil), http.MethodGet, "/alertmanager/route-setting", "")
	assert.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
}

func TestPutRouteSettingHandler_MalformedBody(t *testing.T) {
	db := newRouteDB(t)
	stubPipeline(t)
	w := doJSON(t, newRouteRouter(db, adminUser()), http.MethodPut, "/alertmanager/route-setting",
		`{"default_receiver_channel_id":"not-a-number"}`)
	assert.Equal(t, http.StatusBadRequest, w.Code, "body: %s", w.Body.String())
}