package exportertemplate

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
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

// 采集器模板 supported_monitor_types 登记值校验（create/update 两条路径）：
// 非法 monitor_type 在登记时即报错，避免"入库成功但对所有类型都不可用"的静默失真。
// 依据：scrapejob.validateExporterForMonitorType 的可用类型并集按 ValidMonitorTypes()
// 遍历，非法值不会进入并集 → 模板对所有 monitor_type 都不可用，用户无从追溯。

func TestCreateExporterTemplateRejectsInvalidSupportedMonitorType(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
		`{"name":"nginxx-exporter","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal","supported_monitor_types":["nginxx"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 错误信息须含非法值本身与合法取值清单（用户可据此自查，不必翻文档）。
	body := w.Body.String()
	assert.Contains(t, body, "nginxx", "错误信息应回显非法取值")
	assert.Contains(t, body, "supported_monitor_types", "错误信息应指明出错字段")
	for _, mt := range models.ValidMonitorTypes() {
		assert.Contains(t, body, mt, "错误信息应列出合法取值 %s", mt)
	}

	// 关键：未落库。
	var cnt int64
	require.NoError(t, db.Model(&models.ExporterTemplate{}).Where("name = ?", "nginxx-exporter").Count(&cnt).Error)
	assert.Zero(t, cnt, "校验失败不得落库")

	// 合法值与非法值混合时同样整体拒绝（不做部分保存）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
		`{"name":"mixed-exporter","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal","supported_monitor_types":["nginx","nginxx"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	require.NoError(t, db.Model(&models.ExporterTemplate{}).Where("name = ?", "mixed-exporter").Count(&cnt).Error)
	assert.Zero(t, cnt, "混合数组含非法值时整体拒绝，不得部分落库")
}

// 防误伤回归基线（第一优先级）：空声明（未标注）必须继续放行。
// 下游 exporterTemplateSupportsType / ensureExporterSupportsType 把空声明视为通配，
// 若此处收紧，存量未标注模板将集体失效。
func TestCreateExporterTemplateAllowsEmptySupportedMonitorTypes(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 完全不传该字段（JSON 缺省 → nil）。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
		`{"name":"untyped-a","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal"}`)
	require.Equal(t, http.StatusOK, w.Code, "未标注 supported_monitor_types 应放行（存量兼容）")

	// 显式空数组。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
		`{"name":"untyped-b","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal","supported_monitor_types":[]}`)
	require.Equal(t, http.StatusOK, w.Code, "空数组声明应放行（存量兼容）")

	// 落库确认：两种形态都存为空声明，而非被拒。
	var list []models.ExporterTemplate
	require.NoError(t, db.Find(&list).Error)
	require.Len(t, list, 2)
	for _, e := range list {
		assert.Empty(t, e.SupportedMonitorTypes, "空声明应原样落库 %s", e.Name)
	}
}

func TestCreateExporterTemplateAllowsAllValidSupportedMonitorTypes(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	// 全合法取值（覆盖 ValidMonitorTypes() 全集）应放行且原样落库。
	body := fmt.Sprintf(`{"name":"all-types","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal","supported_monitor_types":[%s]}`,
		quotedJoin(models.ValidMonitorTypes()))
	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates", body)
	require.Equal(t, http.StatusOK, w.Code)

	var got models.ExporterTemplate
	require.NoError(t, db.Where("name = ?", "all-types").First(&got).Error)
	assert.Equal(t, models.ValidMonitorTypes(), got.SupportedMonitorTypes, "全合法取值应原样落库且保持顺序")
}

// 重复值处理口径：去重并保留首次出现顺序，使同一份声明反复保存得到同一序列
// （幂等，不产生无谓 diff）。见 normalizeSupportedMonitorTypes 口径 3。
func TestCreateExporterTemplateDedupsSupportedMonitorTypes(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)

	w := perform(t, r, http.MethodPost, "/api/v2/platform/exporter-templates",
		`{"name":"dup-exporter","default_port":9100,"metrics_path":"/metrics","scheme":"http","source":"internal","supported_monitor_types":["nginx","mysql","nginx"]}`)
	require.Equal(t, http.StatusOK, w.Code, "重复值不属非法，应去重放行")

	var got models.ExporterTemplate
	require.NoError(t, db.Where("name = ?", "dup-exporter").First(&got).Error)
	assert.Equal(t, []string{"nginx", "mysql"}, got.SupportedMonitorTypes, "重复值去重且保留首次出现顺序")
}

func TestUpdateExporterTemplateRejectsInvalidSupportedMonitorType(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{
		Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http",
		SupportedMonitorTypes: []string{"nginx"}, Version: "1.0.0", Source: models.ExporterSourceInternal,
	})
	p := "/api/v2/platform/exporter-templates/" + strconv.FormatUint(uint64(id), 10)

	// 改成非法值 → bad_request。
	w := perform(t, r, http.MethodPut, p, `{"supported_monitor_types":["nginxx"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "nginxx", "错误信息应回显非法取值")

	// 库中原值未被污染。
	var got models.ExporterTemplate
	require.NoError(t, db.First(&got, id).Error)
	assert.Equal(t, []string{"nginx"}, got.SupportedMonitorTypes, "校验失败不得改动库中原值")
	assert.Equal(t, "1.0.0", got.Version, "同一请求内的其他字段也不得落库")

	// 改回合法值 → 放行。
	w = perform(t, r, http.MethodPut, p, `{"supported_monitor_types":["mysql","redis"]}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, db.First(&got, id).Error)
	assert.Equal(t, []string{"mysql", "redis"}, got.SupportedMonitorTypes)
}

// 更新路径的防误伤基线：显式传空数组 / 传 null 均应放行，
// 不因本次收紧把存量"未标注"模板改成不可用。
func TestUpdateExporterTemplateAllowsEmptySupportedMonitorTypes(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{
		Name: "untyped-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http",
		SupportedMonitorTypes: []string{"nginx"}, Source: models.ExporterSourceInternal,
	})
	p := "/api/v2/platform/exporter-templates/" + strconv.FormatUint(uint64(id), 10)

	// 显式清空为未标注 → 放行（下游视为通配，是合法的"取消声明"动作）。
	w := perform(t, r, http.MethodPut, p, `{"supported_monitor_types":[]}`)
	require.Equal(t, http.StatusOK, w.Code, "清空声明应放行")
	var got models.ExporterTemplate
	require.NoError(t, db.First(&got, id).Error)
	assert.Empty(t, got.SupportedMonitorTypes)

	// 不带该字段 → 不改动既有声明。
	seeded := seedExporter(t, db, &models.ExporterTemplate{
		Name: "keep-types", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http",
		SupportedMonitorTypes: []string{"nginx"}, Source: models.ExporterSourceInternal,
	})
	w = perform(t, r, http.MethodPut, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(seeded), 10), `{"version":"2.0.0"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var kept models.ExporterTemplate
	require.NoError(t, db.First(&kept, seeded).Error)
	assert.Equal(t, []string{"nginx"}, kept.SupportedMonitorTypes, "未提交该字段时不应改动声明")
}

// 更新路径的重复值去重口径，与 create 保持一致（同一 helper 保证）。
func TestUpdateExporterTemplateDedupsSupportedMonitorTypes(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	id := seedExporter(t, db, &models.ExporterTemplate{
		Name: "custom-agent", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http",
		Source: models.ExporterSourceInternal,
	})

	w := perform(t, r, http.MethodPut, "/api/v2/platform/exporter-templates/"+strconv.FormatUint(uint64(id), 10),
		`{"supported_monitor_types":["redis","redis","nginx"]}`)
	require.Equal(t, http.StatusOK, w.Code)

	var got models.ExporterTemplate
	require.NoError(t, db.First(&got, id).Error)
	assert.Equal(t, []string{"redis", "nginx"}, got.SupportedMonitorTypes, "重复值去重且保留首次出现顺序")
}

// quotedJoin 把 monitor_type 列表拼成 JSON 数组字面量片段（测试辅助）。
func quotedJoin(items []string) string {
	quoted := make([]string, 0, len(items))
	for _, it := range items {
		quoted = append(quoted, fmt.Sprintf("%q", it))
	}
	return strings.Join(quoted, ",")
}
