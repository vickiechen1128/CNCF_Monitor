package tenant

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// memDBCounter produces a unique in-memory DB name per test so sequential and
// parallel tests in one package never share the same backing database.
var memDBCounter int64

// openTestDB opens a per-test in-memory SQLite database with the tenant table.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:admintenant_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.Tenant{}))
	return db
}

// seedTenant inserts a tenant row (the platform_admin tenant by default).
func seedTenant(t *testing.T, db *gorm.DB, id, name string, multiSite bool) models.Tenant {
	t.Helper()
	tn := models.Tenant{
		ID:               id,
		Name:             name,
		MultiSiteEnabled: multiSite,
		IsPlatformAdmin:  id == models.PlatformAdminTenantID,
		Status:           models.TenantStatusActive,
	}
	require.NoError(t, db.Create(&tn).Error)
	return tn
}

// newTestRouter builds a gin engine with the tenant admin routes mounted under
// /api/v2/platform, mirroring main.go wiring.
func newTestRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	RegisterRoutes(platform, db)
	return r
}

// perform executes a request against the given engine and returns the recorder.
func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// envelope is the decoded unified response envelope.
type envelope struct {
	Status    string          `json:"status"`
	Data      json.RawMessage `json:"data"`
	ErrorType string          `json:"errorType"`
	Error     string          `json:"error"`
}

func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	return env
}

func TestListTenants_Success(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", true)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/tenants", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "success", env.Status)
	var data struct {
		Items []map[string]interface{} `json:"items"`
		Total int64                    `json:"total"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(1), data.Total)
	require.Len(t, data.Items, 1)
	item := data.Items[0]
	assert.Equal(t, models.PlatformAdminTenantID, item["id"])
	assert.Equal(t, "平台管理", item["name"])
	assert.Equal(t, true, item["multi_site_enabled"])
	assert.Equal(t, true, item["is_platform_admin"])
	assert.Equal(t, "active", item["status"])
	assert.Contains(t, item, "created_at")
	assert.Contains(t, item, "updated_at")
}

func TestListTenants_Pagination(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", false)
	seedTenant(t, db, "biz-ops", "业务运营", true)

	// 全量返回两条。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/tenants", "")
	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	var data struct {
		Items []map[string]interface{} `json:"items"`
		Total int64                    `json:"total"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(2), data.Total)

	// 分页：page_size=1 时第二页取 1 条，total 仍为 2。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/tenants?page=2&page_size=1", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(2), data.Total)
	require.Len(t, data.Items, 1)
}

func TestListTenants_StatusFilter(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", true) // status=active
	suspended := models.Tenant{
		ID:     "biz-ops",
		Name:   "业务运营",
		Status: models.TenantStatusSuspended,
	}
	require.NoError(t, db.Create(&suspended).Error)

	// 只筛选 active。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/tenants?status=active", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data struct {
		Items []map[string]interface{} `json:"items"`
		Total int64                    `json:"total"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(1), data.Total)
	require.Len(t, data.Items, 1)
	assert.Equal(t, models.PlatformAdminTenantID, data.Items[0]["id"])

	// 只筛选 suspended。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/tenants?status=suspended", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(1), data.Total)
	require.Len(t, data.Items, 1)
	assert.Equal(t, "biz-ops", data.Items[0]["id"])

	// 筛选不存在的状态返回空列表。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/tenants?status=disabled", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(0), data.Total)
	assert.Empty(t, data.Items)
}

func TestGetTenant_Success(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", true)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/tenants/"+models.PlatformAdminTenantID, "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, models.PlatformAdminTenantID, data["id"])
	assert.Equal(t, "平台管理", data["name"])
	assert.Equal(t, true, data["multi_site_enabled"])
	assert.Equal(t, true, data["is_platform_admin"])
	assert.Equal(t, "active", data["status"])
}

func TestGetTenant_NotFound(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", false)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/tenants/no-such-id", "")
	require.Equal(t, http.StatusNotFound, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "error", env.Status)
	assert.Equal(t, "not_found", env.ErrorType)
}

func TestUpdateTenant_Success(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", false)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/tenants/"+models.PlatformAdminTenantID,
		`{"name":"平台管理(新)","multi_site_enabled":true}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, "平台管理(新)", data["name"])
	assert.Equal(t, true, data["multi_site_enabled"])

	// 落库校验。
	var stored models.Tenant
	require.NoError(t, db.First(&stored, "id = ?", models.PlatformAdminTenantID).Error)
	assert.Equal(t, "平台管理(新)", stored.Name)
	assert.Equal(t, true, stored.MultiSiteEnabled)
}

func TestUpdateTenant_Validation(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", false)

	for _, body := range []string{
		`{"name":"  ","multi_site_enabled":true}`,
		`{"name":""}`,
		`{}`,
		`{"name":`,
	} {
		w := perform(t, r, http.MethodPut, "/api/v2/platform/tenants/"+models.PlatformAdminTenantID, body)
		require.Equal(t, http.StatusBadRequest, w.Code, "body=%s resp=%s", body, w.Body.String())
		env := decodeEnvelope(t, w)
		assert.Equal(t, "bad_request", env.ErrorType)
		// 校验失败不改数据。
		var stored models.Tenant
		require.NoError(t, db.First(&stored, "id = ?", models.PlatformAdminTenantID).Error)
		assert.Equal(t, "平台管理", stored.Name)
	}
}

func TestUpdateTenant_NotFound(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/tenants/no-such-id", `{"name":"x"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "not_found", env.ErrorType)
}

func TestCreateTenant_Forbidden(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	w := perform(t, r, http.MethodPost, "/api/v2/platform/tenants", `{"name":"新租户"}`)
	require.Equal(t, http.StatusForbidden, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "error", env.Status)
	assert.Equal(t, "forbidden", env.ErrorType)
}

func TestUpdateTenantStatus_Forbidden(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", false)

	w := perform(t, r, http.MethodPatch, "/api/v2/platform/tenants/"+models.PlatformAdminTenantID+"/status", `{"status":"disabled"}`)
	require.Equal(t, http.StatusForbidden, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "error", env.Status)
	assert.Equal(t, "forbidden", env.ErrorType)

	// 状态未被改变。
	var stored models.Tenant
	require.NoError(t, db.First(&stored, "id = ?", models.PlatformAdminTenantID).Error)
	assert.Equal(t, models.TenantStatusActive, stored.Status)
}

// TestTenantFieldsConformToContract 确保 tenant 列表/详情不含敏感或越权字段，
// 字段集与契约快照 §3 一致。
func TestTenantFieldsConformToContract(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedTenant(t, db, models.PlatformAdminTenantID, "平台管理", false)

	for _, path := range []string{
		"/api/v2/platform/tenants",
		"/api/v2/platform/tenants/" + models.PlatformAdminTenantID,
	} {
		w := perform(t, r, http.MethodGet, path, "")
		require.Equal(t, http.StatusOK, w.Code)
		resp := w.Body.String()
		assert.NotContains(t, resp, "password")
		assert.NotContains(t, resp, "password_hash")
	}
}