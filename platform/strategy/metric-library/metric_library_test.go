package metriclibrary

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
	dsn := fmt.Sprintf("file:metric_lib_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ExporterMetricLibrary{}))
	return db
}

func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
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

func seedBuiltinMetric(t *testing.T, db *gorm.DB, name, mtype, category, monitorType string, enabled bool) {
	t.Helper()
	require.NoError(t, db.Create(&models.ExporterMetricLibrary{
		MetricName: name,
		MetricType: models.MetricType(mtype),
		Category:   category,
		MonitorTypes: []models.ExporterMetricAnchor{{MonitorType: monitorType, SourceExporter: "node-exporter"}},
		IsBuiltin:  true,
		Enabled:    enabled,
	}).Error)
}

func TestListMetricLibraryFilters(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedBuiltinMetric(t, db, "node_cpu_usage", "gauge", "cpu", "host_linux", true)
	seedBuiltinMetric(t, db, "mysql_connections", "gauge", "connection", "mysql", true)
	seedBuiltinMetric(t, db, "app_http_requests_total", "counter", "http", "application_http", false)

	// monitor_type 筛选。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/metric-library?monitor_type=host_linux", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []models.ExporterMetricLibrary `json:"list"`
			Total int64                           `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)

	// metric_type + category 筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/metric-library?metric_type=gauge&category=connection", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "mysql_connections", out.Data.List[0].MetricName)

	// keyword 筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/metric-library?keyword=cpu", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total)
}

func TestCreateAndUpdateMetricLibrary(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// metric_type 非法 → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/metric-library",
		`{"metric_name":"custom_metric","metric_type":"unknown_type","monitor_types":[{"monitor_type":"mysql"}]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// monitor_types 为空 → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/metric-library",
		`{"metric_name":"custom_metric","metric_type":"gauge","monitor_types":[]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 非法 monitor_type → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/metric-library",
		`{"metric_name":"custom_metric","metric_type":"gauge","monitor_types":[{"monitor_type":"dm8"}]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 合法创建：is_builtin=false。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/metric-library",
		`{"metric_name":"mysql_custom_io","metric_type":"gauge","help":"自定义 IO","unit":"ops","monitor_types":[{"monitor_type":"mysql","source_exporter":"custom"}],"category":"io","enabled":true}`)
	require.Equal(t, http.StatusOK, w.Code)
	var created struct {
		Data models.ExporterMetricLibrary `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	assert.False(t, created.Data.IsBuiltin)
	assert.Equal(t, "mysql_custom_io", created.Data.MetricName)
	assert.Len(t, created.Data.MonitorTypes, 1)
	id := strconv.FormatUint(uint64(created.Data.ID), 10)

	// 重复（同 metric_name + monitor_type）→ bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/metric-library",
		`{"metric_name":"mysql_custom_io","metric_type":"gauge","monitor_types":[{"monitor_type":"mysql"}]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 更新非内置：可改 enabled/help/category。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/metric-library/"+id, `{"enabled":false,"category":"io-v2"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var updated struct {
		Data struct {
			Enabled  bool   `json:"enabled"`
			Category string `json:"category"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &updated))
	assert.Equal(t, false, updated.Data.Enabled)
	assert.Equal(t, "io-v2", updated.Data.Category)

	// 未命中 not_found。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/metric-library/999999", `{"enabled":true}`)
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdateBuiltinForbidden(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedBuiltinMetric(t, db, "node_cpu_usage", "gauge", "cpu", "host_linux", true)

	// 读取内置指标 ID。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/metric-library?keyword=cpu", "")
	var out struct {
		Data struct {
			List []models.ExporterMetricLibrary `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.List, 1)
	id := strconv.FormatUint(uint64(out.Data.List[0].ID), 10)

	// 内置禁改 → forbidden。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/metric-library/"+id, `{"enabled":false}`)
	require.Equal(t, http.StatusForbidden, w.Code)
}