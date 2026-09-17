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
		Status string                  `json:"status"`
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

func TestCreateExporterTemplateRejectsBuiltinButAllowsOfficialThirdParty(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// is_builtin=true 拒绝。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"x","default_port":1,"metrics_path":"/m","scheme":"http","source":"internal","is_builtin":true}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// source=official 允许登记（用户登记的官方采集器恒非内置，仅 name 与 seed 区分）。
	for _, src := range []string{"official", "third_party"} {
		w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
			fmt.Sprintf(`{"name":"%s-usr","default_port":9100,"metrics_path":"/m","scheme":"http","source":"%s"}`, src, src))
		require.Equal(t, http.StatusOK, w.Code, "source=%s 应允许登记", src)
		var out struct {
			Status string                  `json:"status"`
			Data   models.ExporterTemplate `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		assert.False(t, out.Data.IsBuiltin, "用户登记的 official/third_party 恒非内置")
	}

	// 非法 source 拒绝。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"y","default_port":1,"metrics_path":"/m","scheme":"http","source":"community"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateExporterTemplateDuplicateName(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceInternal})

	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"custom-agent","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal"}`)
	require.Equal(t, http.StatusConflict, w.Code)
}

// 回归：软删后重建同名采集器应成功，而不是命中 DB 唯一索引抛 internal error
// （create.go 用 Unscoped 查找软删残留并在重建前物理清理，与 scrapejob 对齐）。
func TestCreateExporterTemplateRecreateAfterSoftDelete(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	body := `{"name":"recreate-me","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal"}`

	// 先登记一个 internal 采集器。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", body)
	require.Equal(t, http.StatusOK, w.Code)
	var created struct {
		Data models.ExporterTemplate `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	id := strconv.FormatUint(uint64(created.Data.ID), 10)

	// 软删该采集器。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/exporter-templates/"+id, "")
	require.Equal(t, http.StatusOK, w.Code)

	// 重建同名采集器：应 200 成功，而不是 500 internal error。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", body)
	require.Equal(t, http.StatusOK, w.Code, "软删后重建同名采集器应成功（避免 uniqueIndex 冲突 500）")

	// 活跃同名仍应冲突。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", body)
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

func TestCreateExporterTemplateDownloadURLValidation(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	base := `{"name":"custom-agent","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal"`

	// 合法 http/https download_url 通过。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", base+`, "download_url":"https://dl.example.com/agent","homepage":"http://example.com"} }`)
	require.Equal(t, http.StatusOK, w.Code)

	// 非 http/https scheme → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", base+`, "download_url":"ftp://dl.example.com/agent"} }`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 缺 host → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", base+`, "download_url":"https://"} }`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// homepage 非法 → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", base+`, "homepage":"javascript:alert(1)"} }`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 未提供 download_url 通过（可选字段）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", `{"name":"agent-nourl","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal"}`)
	require.Equal(t, http.StatusOK, w.Code)
}

func TestCreateExporterTemplateWithDescription(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 登记时提交 description 应被持久化并回显。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
		`{"name":"custom-agent","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal","description":"自定义采集器描述"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ExporterTemplate `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "自定义采集器描述", out.Data.Description)
}

func TestUpdateExporterTemplateDownloadURLValidation(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceInternal})
	p := "/api/v2/platform/exporter-templates/" + strconv.FormatUint(uint64(id), 10)

	// 合法 URL 更新通过。
	w := perform(t, r, http.MethodPut, p, `{"download_url":"https://dl.example.com/agent"}`)
	require.Equal(t, http.StatusOK, w.Code)

	// 非法 scheme → bad_request。
	w = perform(t, r, http.MethodPut, p, `{"download_url":"file:///etc/passwd"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 缺 host → bad_request。
	w = perform(t, r, http.MethodPut, p, `{"homepage":"https://"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
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
