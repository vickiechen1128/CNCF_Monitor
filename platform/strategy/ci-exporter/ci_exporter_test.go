package ciexporter

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:ciexporter_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.ExporterTemplate{},
		&models.CITypeExporterMapping{},
		&models.LabelTemplate{},
		&models.ScrapeJob{},
	))
	return db
}

func newGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	RegisterRoutes(r.Group("/api/v2/platform"), db)
	return r
}

func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Buffer
	if body == "" {
		buf = bytes.NewBuffer(nil)
	} else {
		buf = bytes.NewBufferString(body)
	}
	req := httptest.NewRequest(method, path, buf)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// seedExporterWithID persists an exporter and returns its real ID string.
func seedExporterWithID(t *testing.T, db *gorm.DB, name string) string {
	t.Helper()
	e := &models.ExporterTemplate{Name: name, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceOfficial, IsBuiltin: true, InstallGuide: "https://example.com/" + name}
	require.NoError(t, db.Create(e).Error)
	return strconv.FormatUint(uint64(e.ID), 10)
}

func seedLabelTemplate(t *testing.T, db *gorm.DB, name, category string) uint {
	t.Helper()
	lt := &models.LabelTemplate{Name: name, ResourceCategory: models.ResourceCategory(category), IsDefault: false}
	require.NoError(t, db.Create(lt).Error)
	return lt.ID
}

func TestListCITypeExporterMappingsEmpty(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	w := perform(t, r, http.MethodGet, "/api/v2/platform/ci-exporter-mappings", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string `json:"status"`
		Data   struct {
			List     []mappingListItem `json:"list"`
			Total    int64             `json:"total"`
			Page     int               `json:"page"`
			PageSize int               `json:"page_size"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Empty(t, out.Data.List, "空结果返回空 list")
	assert.Equal(t, 20, out.Data.PageSize, "page_size 默认 20")
}

func TestListCITypeExporterMappingsFiltersAndFlags(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	hostID := seedExporterWithID(t, db, "node-exporter")
	mysqlID := seedExporterWithID(t, db, "mysqld-exporter")

	// host_linux 默认映射带 install_guide 透传。
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: hostID, IsDefault: true,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s", IsBuiltin: true,
	}).Error)
	// mysql 映射带 label_template_id → has_label_template=true。
	ltID := seedLabelTemplate(t, db, "mysql-tpl", "database")
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "mysql", ExporterTemplateID: mysqlID, IsDefault: false,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s", LabelTemplateID: strconv.FormatUint(uint64(ltID), 10),
	}).Error)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/ci-exporter-mappings?monitor_type=mysql", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []mappingListItem `json:"list"`
			Total int64             `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.List, 1)
	assert.True(t, out.Data.List[0].HasLabelTemplate, "带 label_template_id 时 has_label_template 为 true")
	assert.False(t, out.Data.List[0].IsReferenced, "未被 ScrapeJob 引用时 is_referenced 为 false")
	assert.Equal(t, "https://example.com/mysqld-exporter", out.Data.List[0].InstallGuide)

	// is_default=true 筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/ci-exporter-mappings?is_default=true", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.List, 1)
	assert.True(t, out.Data.List[0].IsDefault)
}

func TestCreateCITypeExporterMappingOK(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	hostID := seedExporterWithID(t, db, "node-exporter")

	w := perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings",
		fmt.Sprintf(`{"monitor_type":"host_windows","exporter_template_id":"%s","is_default":true,"metrics_path":"/metrics","scheme":"http","scrape_interval":"15s","scrape_timeout":"10s"}`, hostID))
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string `json:"status"`
		Data   struct {
			MonitorType string `json:"monitor_type"`
			IsBuiltin   bool   `json:"is_builtin"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, "host_windows", out.Data.MonitorType)
	assert.False(t, out.Data.IsBuiltin, "登记的非内置")
}

func TestCreateCITypeExporterMappingValidation(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	hostID := seedExporterWithID(t, db, "node-exporter")

	// 缺 monitor_type。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings", fmt.Sprintf(`{"exporter_template_id":"%s"}`, hostID))
	require.Equal(t, http.StatusBadRequest, w.Code)
	// exporter 不存在。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings", `{"monitor_type":"mysql","exporter_template_id":"999999"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	// label_template_id 不存在。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings", fmt.Sprintf(`{"monitor_type":"mysql","exporter_template_id":"%s","label_template_id":"777"}`, hostID))
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateDuplicateDefaultRejected(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	nodeID := seedExporterWithID(t, db, "node-exporter")
	otherID := seedExporterWithID(t, db, "textfile-exporter")

	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: nodeID, IsDefault: true,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s",
	}).Error)

	// 同类型再建 is_default=true → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings",
		fmt.Sprintf(`{"monitor_type":"host_linux","exporter_template_id":"%s","is_default":true,"metrics_path":"/m","scheme":"http"}`, otherID))
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestUpdateCITypeExporterMapping(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	hostID := seedExporterWithID(t, db, "node-exporter")
	m := &models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: hostID, IsDefault: true,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s",
	}
	require.NoError(t, db.Create(m).Error)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/ci-exporter-mappings/"+strconv.FormatUint(uint64(m.ID), 10), `{"scrape_interval":"30s","default_port":9100}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			ScrapeInterval string `json:"scrape_interval"`
			DefaultPort    int    `json:"default_port"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "30s", out.Data.ScrapeInterval)
	assert.Equal(t, 9100, out.Data.DefaultPort)
}

func TestDeleteCITypeExporterMapping(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	hostID := seedExporterWithID(t, db, "node-exporter")

	// 内置禁删 bad_request。
	builtin := &models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: hostID, IsDefault: true,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s", IsBuiltin: true,
	}
	require.NoError(t, db.Create(builtin).Error)
	w := perform(t, r, http.MethodDelete, "/api/v2/platform/ci-exporter-mappings/"+strconv.FormatUint(uint64(builtin.ID), 10), "")
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 被 ScrapeJob 引用禁删 forbidden。
	ref := &models.CITypeExporterMapping{
		MonitorType: "mysql", ExporterTemplateID: seedExporterWithID(t, db, "mysqld-exporter"), IsDefault: false,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s",
	}
	require.NoError(t, db.Create(ref).Error)
	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "mysql-job", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeDatabase,
		MonitorType: "mysql", ExporterTemplateID: ref.ExporterTemplateID, NetworkDomainID: "default",
		InstanceSelectionMode: models.InstanceSelectionManual, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone,
	}).Error)
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/ci-exporter-mappings/"+strconv.FormatUint(uint64(ref.ID), 10), "")
	require.Equal(t, http.StatusForbidden, w.Code)

	// 未命中 not_found。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/ci-exporter-mappings/999999", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}