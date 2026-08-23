// label_write_test.go 覆盖 ResourceLabel 写接口（T07-12）：POST/PUT/DELETE
// /api/v2/platform/resources/:resource_id/labels[/:label_id]。验收要点：
// 仅 application 可写 user 标签（host/database/middleware/generic_target 403）、
// key 校验（非法 / 内置 label / system 覆盖拒绝）、重复 key conflict、
// PUT/DELETE 仅 user 来源可操作（非 user forbidden）、资源/标签未命中 not_found。
package resource

import (
	"encoding/json"
	"fmt"
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

// labelWriteTestDBCounter 为每个测试生成唯一的内存 DB 名，避免同包内测试共享同一库。
var labelWriteTestDBCounter int64

// openLabelWriteTestDB 打开逐测试的内存 SQLite，并迁移标签写接口涉及的表：
// 五类资源 + LabelTemplate（system 实时计算） + ResourceLabel（user 落库）。
func openLabelWriteTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&labelWriteTestDBCounter, 1)
	dsn := fmt.Sprintf("file:resource_label_write_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.LabelTemplate{},
		&models.ResourceLabel{},
	))
	return db
}

// mountLabelWriteHandlers 挂载标签写接口 handler 供测试（路由收口见 T07-18，此处仅测试挂载）。
func mountLabelWriteHandlers(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/v2/platform/resources/:resource_id/labels", CreateResourceLabel(db))
	r.PUT("/api/v2/platform/resources/:resource_id/labels/:label_id", UpdateResourceLabel(db))
	r.DELETE("/api/v2/platform/resources/:resource_id/labels/:label_id", DeleteResourceLabel(db))
	return r
}

// labelWriteResponse 镜像标签写接口的统一响应信封，data 为不定形 JSON
// （新增/更新后的标签项，或 {label_id}）。
type labelWriteResponse struct {
	Status    string      `json:"status"`
	ErrorType string      `json:"errorType"`
	Error     string      `json:"error"`
	Data      interface{} `json:"data"`
}

// doCreateLabel 请求添加标签接口并解码统一响应。
func doCreateLabel(t *testing.T, r *gin.Engine, resourceID, body string) (*httptest.ResponseRecorder, labelWriteResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v2/platform/resources/"+resourceID+"/labels", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out labelWriteResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// doUpdateLabel 请求编辑标签接口并解码统一响应。
func doUpdateLabel(t *testing.T, r *gin.Engine, resourceID, labelID, body string) (*httptest.ResponseRecorder, labelWriteResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/v2/platform/resources/"+resourceID+"/labels/"+labelID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out labelWriteResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// doDeleteLabel 请求删除标签接口并解码统一响应。
func doDeleteLabel(t *testing.T, r *gin.Engine, resourceID, labelID string) (*httptest.ResponseRecorder, labelWriteResponse) {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/api/v2/platform/resources/"+resourceID+"/labels/"+labelID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out labelWriteResponse
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w, out
}

// seedLabelWriteApplication 落一条应用服务 fixture。
func seedLabelWriteApplication(t *testing.T, db *gorm.DB, id string) *models.Application {
	t.Helper()
	a := &models.Application{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeApplication,
		ResourceCategory: models.ResourceCategoryApplication,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppName:          "order-svc",
		Env:              "prod",
		Cluster:          "pay-cluster",
		Status:           "online",
		ServiceName:      "order-svc",
		HealthCheckURL:   "http://10.0.0.5:8080/healthz",
		Protocol:         "http",
		Endpoint:         "10.0.0.5:8080",
	}
	require.NoError(t, db.Create(a).Error)
	return a
}

// seedLabelWriteHost 落一条主机 fixture。
func seedLabelWriteHost(t *testing.T, db *gorm.DB, id string) *models.Host {
	t.Helper()
	h := &models.Host{
		ResourceID:       id,
		ServerID:         id,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppCode:          "payment-api",
		EnvFlag:          "prod",
		InstanceName:     "web-01.example.com",
		Status:           "online",
		Image:            "linux",
		PrivateIP:        "10.0.0.1",
	}
	require.NoError(t, db.Create(h).Error)
	return h
}

// seedLabelWriteDatabase 落一条数据库 fixture。
func seedLabelWriteDatabase(t *testing.T, db *gorm.DB, id string) *models.Database {
	t.Helper()
	d := &models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID:       id,
			ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID:  "default",
			BizCode:          "payment",
			AppName:          strPtr("order-db"),
			Env:              "prod",
			Cluster:          strPtr("db-cluster"),
			Owner:            "alice",
			Status:           "online",
			SourceType:       models.SourceTypeManual,
		},
		DatabaseType: "mysql",
		InstanceIP:   "10.0.0.10",
		Port:         3306,
		ResourceType: models.ResourceTypeDatabase,
	}
	require.NoError(t, db.Create(d).Error)
	return d
}

// seedLabelWriteMiddleware 落一条中间件 fixture。
func seedLabelWriteMiddleware(t *testing.T, db *gorm.DB, id string) *models.Middleware {
	t.Helper()
	m := &models.Middleware{
		ResourceID:       id,
		ResourceType:     models.ResourceTypeMiddleware,
		ResourceCategory: models.ResourceCategoryMiddleware,
		NetworkDomainID:  "default",
		BizCode:          "payment",
		SourceType:       models.SourceTypeManual,
		AppName:          "kafka",
		Env:              "prod",
		Cluster:          "mq-cluster",
		Status:           "online",
		MiddlewareType:   "kafka",
		InstanceIP:       "10.0.0.30",
		Port:             9092,
	}
	require.NoError(t, db.Create(m).Error)
	return m
}

// seedLabelWriteGenericTarget 落一条通用指标目标 fixture。
func seedLabelWriteGenericTarget(t *testing.T, db *gorm.DB, id string) *models.GenericTarget {
	t.Helper()
	g := &models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID:       id,
			ResourceCategory: models.ResourceCategoryGenericTarget,
			NetworkDomainID:  "default",
			BizCode:          "payment",
			Env:              "prod",
			Status:           "online",
			SourceType:       models.SourceTypeManual,
		},
		TargetName:   "snmp-router-01",
		InstanceIP:   "10.0.0.20",
		Port:         161,
		MetricsPath:  "/metrics",
		Scheme:       "http",
		ExporterType: "snmp_exporter",
		ResourceType: models.ResourceTypeGenericTarget,
	}
	require.NoError(t, db.Create(g).Error)
	return g
}

// seedLabelWriteUserLabel 落一条 user 来源标签 fixture。
func seedLabelWriteUserLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel {
	t.Helper()
	l := &models.ResourceLabel{
		ResourceID: resourceID,
		Key:        key,
		Value:      value,
		Source:     models.LabelSourceUser,
	}
	require.NoError(t, db.Create(l).Error)
	return l
}

// seedLabelWriteCMDBLabel 落一条 cmdb 来源标签 fixture（v0.4+ 预留占位，
// 用于验证非 user 来源不可编辑/删除）。
func seedLabelWriteCMDBLabel(t *testing.T, db *gorm.DB, resourceID, key, value string) *models.ResourceLabel {
	t.Helper()
	l := &models.ResourceLabel{
		ResourceID: resourceID,
		Key:        key,
		Value:      value,
		Source:     models.LabelSourceCMDB,
	}
	require.NoError(t, db.Create(l).Error)
	return l
}

// seedLabelWriteTemplate 落一条标签模板 fixture。
func seedLabelWriteTemplate(t *testing.T, db *gorm.DB, tmpl *models.LabelTemplate) {
	t.Helper()
	require.NoError(t, db.Create(tmpl).Error)
}

// applicationLabelDefaultTemplate 构造应用默认标签模板（app_name→app、env→env），
// 用于验证「user 不可覆盖 system」拦截（§8.2）。
func applicationLabelDefaultTemplate() *models.LabelTemplate {
	return &models.LabelTemplate{
		Name:             "应用默认模板",
		ResourceCategory: models.ResourceCategoryApplication,
		IsDefault:        true,
		Mappings: []models.LabelMapping{
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
		},
	}
}

// countStoredLabels 统计某资源下未软删的库内标签数。
func countStoredLabels(t *testing.T, db *gorm.DB, resourceID string) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.ResourceLabel{}).Where("resource_id = ?", resourceID).Count(&n).Error)
	return n
}

// TestCreateResourceLabel_ApplicationSuccess 覆盖 application 写 user 标签成功：
// 返回新增标签（含真实库内 id、source=user），且落库可查。
func TestCreateResourceLabel_ApplicationSuccess(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")

	w, out := doCreateLabel(t, r, "app-1", `{"key":"team","value":"pay"}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)

	data, ok := out.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "team", data["key"])
	assert.Equal(t, "pay", data["value"])
	assert.Equal(t, "user", data["source"])
	assert.NotZero(t, data["id"], "user 标签应带真实库内 id")

	var got models.ResourceLabel
	require.NoError(t, db.Where("resource_id = ? AND key = ? AND source = ?", "app-1", "team", models.LabelSourceUser).First(&got).Error)
	assert.Equal(t, "pay", got.Value)
}

// TestCreateResourceLabel_StaticResourceForbidden 覆盖静态资源（host/database/
// middleware/generic_target）写 user 标签返回 403，文案提示静态资源由
// CMDB/Excel 带入（§11.1）。
func TestCreateResourceLabel_StaticResourceForbidden(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)

	seeds := []struct {
		id   string
		seed func(*testing.T, *gorm.DB, string)
	}{
		{"host-1", func(t *testing.T, db *gorm.DB, id string) { seedLabelWriteHost(t, db, id) }},
		{"db-1", func(t *testing.T, db *gorm.DB, id string) { seedLabelWriteDatabase(t, db, id) }},
		{"mw-1", func(t *testing.T, db *gorm.DB, id string) { seedLabelWriteMiddleware(t, db, id) }},
		{"gt-1", func(t *testing.T, db *gorm.DB, id string) { seedLabelWriteGenericTarget(t, db, id) }},
	}
	for _, s := range seeds {
		s.seed(t, db, s.id)
		w, out := doCreateLabel(t, r, s.id, `{"key":"team","value":"pay"}`)
		require.Equal(t, http.StatusForbidden, w.Code, "静态资源 %s 应返回 403", s.id)
		assert.Equal(t, "error", out.Status)
		assert.Equal(t, "forbidden", out.ErrorType)
		assert.Contains(t, out.Error, "该资源为静态资源，标签由 CMDB/Excel 带入，不支持手动打标")
	}
}

// TestCreateResourceLabel_ResourceNotFound 覆盖资源不存在返回 not_found。
func TestCreateResourceLabel_ResourceNotFound(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)

	w, out := doCreateLabel(t, r, "no-such-resource", `{"key":"team","value":"pay"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "no-such-resource")
}

// TestCreateResourceLabel_KeyInvalid 覆盖 key 非法（ValidateLabelKey）返回
// bad_request：大写、含连字符、__ 开头、超长。
func TestCreateResourceLabel_KeyInvalid(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")

	invalidKeys := []string{
		"Team",                 // 大写
		"team-name",            // 连字符
		"__reserved",           // __ 开头
		strings.Repeat("a", 129), // 超 128
	}
	for _, k := range invalidKeys {
		body := fmt.Sprintf(`{"key":%q,"value":"v"}`, k)
		w, out := doCreateLabel(t, r, "app-1", body)
		require.Equal(t, http.StatusBadRequest, w.Code, "key %q 应返回 bad_request", k)
		assert.Equal(t, "error", out.Status)
		assert.Equal(t, "bad_request", out.ErrorType)
		assert.NotEmpty(t, out.Error)
	}
}

// TestCreateResourceLabel_ProtectedKeyRejected 覆盖 key ∈ PROTECTED_PROMETHEUS_LABELS
// 拒绝（bad_request）：禁止覆盖 Prometheus 内置 label（§5.3）。
func TestCreateResourceLabel_ProtectedKeyRejected(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")

	for _, k := range []string{"instance", "job", "scheme"} {
		body := fmt.Sprintf(`{"key":%q,"value":"v"}`, k)
		w, out := doCreateLabel(t, r, "app-1", body)
		require.Equal(t, http.StatusBadRequest, w.Code, "内置 label %q 应被拒绝", k)
		assert.Equal(t, "error", out.Status)
		assert.Equal(t, "bad_request", out.ErrorType)
		assert.Contains(t, out.Error, "内置标签")
	}
}

// TestCreateResourceLabel_SystemKeyRejected 覆盖 key 为该资源 system 标签拒绝
// （user 不可覆盖 system，§8.2）：默认模板计算出的 app 标签不可被 user 覆盖。
func TestCreateResourceLabel_SystemKeyRejected(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")
	seedLabelWriteTemplate(t, db, applicationLabelDefaultTemplate())

	w, out := doCreateLabel(t, r, "app-1", `{"key":"app","value":"custom"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "bad_request", out.ErrorType)
	assert.Contains(t, out.Error, "系统保护标签")

	// 非 system 的 key 不受影响，可正常写入。
	w2, out2 := doCreateLabel(t, r, "app-1", `{"key":"team","value":"pay"}`)
	require.Equal(t, http.StatusOK, w2.Code)
	assert.Equal(t, "success", out2.Status)
}

// TestCreateResourceLabel_DuplicateKeyConflict 覆盖同资源重复 key 返回 conflict。
func TestCreateResourceLabel_DuplicateKeyConflict(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")
	seedLabelWriteUserLabel(t, db, "app-1", "team", "pay")

	w, out := doCreateLabel(t, r, "app-1", `{"key":"team","value":"ops"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "conflict", out.ErrorType)
	assert.Contains(t, out.Error, "team")

	// 不同资源可用相同 key，互不影响。
	seedLabelWriteApplication(t, db, "app-2")
	w2, out2 := doCreateLabel(t, r, "app-2", `{"key":"team","value":"pay"}`)
	require.Equal(t, http.StatusOK, w2.Code)
	assert.Equal(t, "success", out2.Status)
}

// TestUpdateResourceLabel_Success 覆盖编辑 user 标签 value 成功并落库。
func TestUpdateResourceLabel_Success(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")
	l := seedLabelWriteUserLabel(t, db, "app-1", "team", "pay")

	w, out := doUpdateLabel(t, r, "app-1", fmt.Sprintf("%d", l.ID), `{"value":"ops"}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)

	data, ok := out.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(l.ID), data["id"])
	assert.Equal(t, "team", data["key"])
	assert.Equal(t, "ops", data["value"])
	assert.Equal(t, "user", data["source"])

	var got models.ResourceLabel
	require.NoError(t, db.First(&got, l.ID).Error)
	assert.Equal(t, "ops", got.Value)
}

// TestUpdateResourceLabel_NonUserForbidden 覆盖编辑非 user 来源标签 forbidden
// （§6.6.2）：cmdb 来源不可编辑。
func TestUpdateResourceLabel_NonUserForbidden(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")
	l := seedLabelWriteCMDBLabel(t, db, "app-1", "cmdb_owner", "alice")

	w, out := doUpdateLabel(t, r, "app-1", fmt.Sprintf("%d", l.ID), `{"value":"bob"}`)
	require.Equal(t, http.StatusForbidden, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "forbidden", out.ErrorType)
	assert.Contains(t, out.Error, "仅 user 来源")
}

// TestUpdateResourceLabel_StaticResourceForbidden 覆盖编辑静态资源标签 forbidden
// （写接口边界同样覆盖 PUT，§6.2）。
func TestUpdateResourceLabel_StaticResourceForbidden(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteHost(t, db, "host-1")
	l := seedLabelWriteUserLabel(t, db, "host-1", "team", "pay")

	w, out := doUpdateLabel(t, r, "host-1", fmt.Sprintf("%d", l.ID), `{"value":"ops"}`)
	require.Equal(t, http.StatusForbidden, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "forbidden", out.ErrorType)
	assert.Contains(t, out.Error, "该资源为静态资源")
}

// TestUpdateResourceLabel_NotFound 覆盖标签未命中 not_found。
func TestUpdateResourceLabel_NotFound(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")

	w, out := doUpdateLabel(t, r, "app-1", "99999", `{"value":"ops"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "not_found", out.ErrorType)
}

// TestUpdateResourceLabel_ResourceNotFound 覆盖资源未命中 not_found。
func TestUpdateResourceLabel_ResourceNotFound(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)

	w, out := doUpdateLabel(t, r, "no-such-resource", "1", `{"value":"ops"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "no-such-resource")
}

// TestDeleteResourceLabel_Success 覆盖删除 user 标签成功：返回 {label_id}，
// 软删后不再可查。
func TestDeleteResourceLabel_Success(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")
	l := seedLabelWriteUserLabel(t, db, "app-1", "team", "pay")

	w, out := doDeleteLabel(t, r, "app-1", fmt.Sprintf("%d", l.ID))
	require.Equal(t, http.StatusOK, w.Code)
	require.Equal(t, "success", out.Status)

	data, ok := out.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, fmt.Sprintf("%d", l.ID), data["label_id"])

	assert.Equal(t, int64(0), countStoredLabels(t, db, "app-1"), "删除后该资源下不应有可查标签")
}

// TestDeleteResourceLabel_NonUserForbidden 覆盖删除非 user 来源标签 forbidden
// （§6.6.2）：cmdb 来源不可删除。
func TestDeleteResourceLabel_NonUserForbidden(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")
	l := seedLabelWriteCMDBLabel(t, db, "app-1", "cmdb_owner", "alice")

	w, out := doDeleteLabel(t, r, "app-1", fmt.Sprintf("%d", l.ID))
	require.Equal(t, http.StatusForbidden, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "forbidden", out.ErrorType)
	assert.Contains(t, out.Error, "仅 user 来源")
}

// TestDeleteResourceLabel_StaticResourceForbidden 覆盖删除静态资源标签 forbidden
// （§6.2）。
func TestDeleteResourceLabel_StaticResourceForbidden(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteGenericTarget(t, db, "gt-1")
	l := seedLabelWriteUserLabel(t, db, "gt-1", "team", "pay")

	w, out := doDeleteLabel(t, r, "gt-1", fmt.Sprintf("%d", l.ID))
	require.Equal(t, http.StatusForbidden, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "forbidden", out.ErrorType)
	assert.Contains(t, out.Error, "该资源为静态资源")
}

// TestDeleteResourceLabel_NotFound 覆盖标签未命中 not_found。
func TestDeleteResourceLabel_NotFound(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)
	seedLabelWriteApplication(t, db, "app-1")

	w, out := doDeleteLabel(t, r, "app-1", "99999")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "not_found", out.ErrorType)
}

// TestDeleteResourceLabel_ResourceNotFound 覆盖资源未命中 not_found。
func TestDeleteResourceLabel_ResourceNotFound(t *testing.T) {
	db := openLabelWriteTestDB(t)
	r := mountLabelWriteHandlers(t, db)

	w, out := doDeleteLabel(t, r, "no-such-resource", "1")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "not_found", out.ErrorType)
	assert.Contains(t, out.Error, "no-such-resource")
}

// TestResourceLabelUniqueIndex 验证 (resource_id, key, source) 唯一索引
// （dev-feedback L-3）：同资源同 key 同来源重复直插被数据库拒绝（并发竞态的
// 兜底防线）；同 key 不同来源（user / cmdb 预留）可共存。
func TestResourceLabelUniqueIndex(t *testing.T) {
	db := openLabelWriteTestDB(t)

	first := &models.ResourceLabel{
		ResourceID: "app-uniq", Key: "team", Value: "pay", Source: models.LabelSourceUser,
	}
	require.NoError(t, db.Create(first).Error)

	dup := &models.ResourceLabel{
		ResourceID: "app-uniq", Key: "team", Value: "ops", Source: models.LabelSourceUser,
	}
	require.Error(t, db.Create(dup).Error, "同 (resource_id,key,source) 重复插入必须被唯一索引拒绝")

	// 不同资源同 key 同来源可共存。
	otherRes := &models.ResourceLabel{
		ResourceID: "app-uniq-2", Key: "team", Value: "pay", Source: models.LabelSourceUser,
	}
	require.NoError(t, db.Create(otherRes).Error)

	// 同资源同 key 不同来源（cmdb 预留占位）可共存。
	cmdb := &models.ResourceLabel{
		ResourceID: "app-uniq", Key: "team", Value: "cmdb", Source: models.LabelSourceCMDB,
	}
	require.NoError(t, db.Create(cmdb).Error)
}
