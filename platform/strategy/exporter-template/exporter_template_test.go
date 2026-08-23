package exportertemplate

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

// openTestDB opens a per-test in-memory SQLite database with the tables the
// exporter-template package touches.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:exporter_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.ExporterTemplate{},
		&models.CITypeExporterMapping{},
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

func seedExporter(t *testing.T, db *gorm.DB, e *models.ExporterTemplate) uint {
	t.Helper()
	require.NoError(t, db.Create(e).Error)
	return e.ID
}

func seedMapping(t *testing.T, db *gorm.DB, m *models.CITypeExporterMapping) {
	t.Helper()
	require.NoError(t, db.Create(m).Error)
}

func TestListExporterTemplatesEmptyAndDefaults(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/exporter-templates", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string `json:"status"`
		Data   struct {
			List     []models.ExporterTemplate `json:"list"`
			Total    int64                     `json:"total"`
			Page     int                       `json:"page"`
			PageSize int                       `json:"page_size"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Empty(t, out.Data.List, "空结果返回空 list 而非 null")
	assert.Equal(t, int64(0), out.Data.Total)
	assert.Equal(t, 1, out.Data.Page)
	assert.Equal(t, 20, out.Data.PageSize, "page_size 默认 20")
}

func TestListExporterTemplatesMonitoredTypeAndSourceFilter(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedExporter(t, db, &models.ExporterTemplate{Name: "node-exporter", MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"host_linux", "host_windows"}, Source: models.ExporterSourceOfficial, IsBuiltin: true})
	seedExporter(t, db, &models.ExporterTemplate{Name: "mysqld-exporter", MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"mysql"}, Source: models.ExporterSourceOfficial, IsBuiltin: true})
	seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"host_linux"}, Source: models.ExporterSourceInternal})

	// monitor_type 筛选命中 supported_monitor_types。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/exporter-templates?monitor_type=mysql", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []models.ExporterTemplate `json:"list"`
			Total int64                     `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "mysqld-exporter", out.Data.List[0].Name)

	// source=internal 仅返回自建。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/exporter-templates?source=internal", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "custom-agent", out.Data.List[0].Name)
}

func TestCreateExporterTemplateInternal(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	body := `{"name":"custom-agent","version":"1.0.0","default_port":9100,"metrics_path":"/metrics","scheme":"http","supported_monitor_types":["host_linux"],"os":"linux","arch":"amd64","source":"internal"}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string                `json:"status"`
		Data   models.ExporterTemplate `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, "custom-agent", out.Data.Name)
	assert.False(t, out.Data.IsBuiltin, "登记恒非内置")
	assert.Equal(t, models.ExporterSourceInternal, out.Data.Source)
}

func TestCreateExporterTemplateNameMetricsPathSchemeRequired(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// source=internal 缺 default_port。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"x","metrics_path":"/m","scheme":"http","source":"internal"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 缺 metrics_path / scheme。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"x","default_port":1,"source":"internal"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// name 为空。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"","default_port":1,"metrics_path":"/m","scheme":"http","source":"internal"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateExporterTemplateRejectsBuiltinAndNonInternal(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// is_builtin=true 拒绝。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"x","default_port":1,"metrics_path":"/m","scheme":"http","source":"internal","is_builtin":true}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// source=official 拒绝登记（平台预置只读）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"x","default_port":1,"metrics_path":"/m","scheme":"http","source":"official"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateExporterTemplateDuplicateName(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceInternal})

	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"custom-agent","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal"}`)
	require.Equal(t, http.StatusConflict, w.Code)
}

func TestUpdateExporterTemplateInternal(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", Version: "1.0.0", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceInternal})

	w := perform(t, r, http.MethodPut, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(id), 10), `{"version":"1.1.0","default_port":9200}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ExporterTemplate `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "1.1.0", out.Data.Version)
	assert.Equal(t, 9200, out.Data.DefaultPort)
	assert.Equal(t, "custom-agent", out.Data.Name)
}

func TestUpdateExporterTemplateBuiltinForbiddenAndNotFound(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{Name: "node-exporter", MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceOfficial, IsBuiltin: true})

	// 内置只读 → forbidden。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(id), 10), `{"version":"2.0.0"}`)
	require.Equal(t, http.StatusForbidden, w.Code)

	// 未命中 → not_found。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/exporter-templates/999999", `{"version":"1.0.0"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestDeleteExporterTemplateInternalOK(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceInternal})

	w := perform(t, r, http.MethodDelete, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(id), 10), "")
	require.Equal(t, http.StatusOK, w.Code)

	// 软删后列表不含。
	var out struct {
		Data struct {
			List  []models.ExporterTemplate `json:"list"`
			Total int64                     `json:"total"`
		} `json:"data"`
	}
	w = perform(t, r, http.MethodGet, "/api/v2/platform/exporter-templates", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(0), out.Data.Total)
}

func TestDeleteExporterTemplateBuiltinAndReferencedForbidden(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 内置禁删。
	builtinID := seedExporter(t, db, &models.ExporterTemplate{Name: "node-exporter", MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceOfficial, IsBuiltin: true})
	w := perform(t, r, http.MethodDelete, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(builtinID), 10), "")
	require.Equal(t, http.StatusForbidden, w.Code)

	// 被映射引用禁删。
	refID := seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceInternal})
	seedMapping(t, db, &models.CITypeExporterMapping{
		MonitorType:        "host_linux",
		ExporterTemplateID: strconv.FormatUint(uint64(refID), 10),
		MetricsPath:        "/metrics",
		Scheme:             "http",
		ScrapeInterval:     "15s",
		ScrapeTimeout:      "10s",
	})
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(refID), 10), "")
	require.Equal(t, http.StatusForbidden, w.Code)

	// 未命中 not_found。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/exporter-templates/999999", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}