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

// seedMappingWithLabelTemplate 落一条引用指定标签模板的 CI 类型映射行。
// exporterName 独立传入（ExporterTemplate.name 唯一，同一 monitor_type 可落多条映射）。
func seedMappingWithLabelTemplate(t *testing.T, db *gorm.DB, monitorType, exporterName, labelTemplateID string, isDefault, isBuiltin bool) *models.CITypeExporterMapping {
	t.Helper()
	m := &models.CITypeExporterMapping{
		MonitorType: monitorType, ExporterTemplateID: seedExporterWithID(t, db, exporterName),
		IsDefault: isDefault, MetricsPath: "/metrics", Scheme: "http",
		ScrapeInterval: "15s", ScrapeTimeout: "10s", LabelTemplateID: labelTemplateID, IsBuiltin: isBuiltin,
	}
	require.NoError(t, db.Create(m).Error)
	return m
}

// reverseLookup 按 label_template_id 反查 CI 类型映射行，断言 HTTP 码与 total。
func reverseLookup(t *testing.T, r *gin.Engine, labelTemplateID string) (int, []models.CITypeExporterMapping, int64) {
	t.Helper()
	w := perform(t, r, http.MethodGet, "/api/v2/platform/ci-exporter-mappings?label_template_id="+labelTemplateID, "")
	var out struct {
		Data struct {
			List  []models.CITypeExporterMapping `json:"list"`
			Total int64                          `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out.Data.List, out.Data.Total
}

// TestListCITypeExporterMappingsByLabelTemplate 覆盖 M01 侧 CI 类型映射表的标签模板
// 反查（PRD §6.6.3.1 决策 119）：供 M07 模板删除引用保护只读消费，不跨模块直查表。
func TestListCITypeExporterMappingsByLabelTemplate(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	ltID := seedLabelTemplate(t, db, "shared-tpl", "database")
	ltIDStr := strconv.FormatUint(uint64(ltID), 10)

	// 两条引用该模板：一条每类型默认、一条内置（均须计入引用）。
	seedMappingWithLabelTemplate(t, db, "mysql", "mysql-exporter", ltIDStr, true, false)
	seedMappingWithLabelTemplate(t, db, "redis", "redis-exporter", ltIDStr, false, true)
	// 引用另一模板，不应被反查命中。
	otherID := strconv.FormatUint(uint64(seedLabelTemplate(t, db, "other-tpl", "database")), 10)
	seedMappingWithLabelTemplate(t, db, "mysql", "mysqld-exporter", otherID, false, false)

	code, list, total := reverseLookup(t, r, ltIDStr)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(2), total, "引用该模板的映射行全部计入，含 is_default / is_builtin")
	require.Len(t, list, 2)
	for _, m := range list {
		assert.Equal(t, ltIDStr, m.LabelTemplateID, "仅返回引用该模板的行")
	}

	// 无引用 → 200 + total=0 + 空 list（非 404）。
	emptyID := strconv.FormatUint(uint64(seedLabelTemplate(t, db, "unused-tpl", "database")), 10)
	code, list, total = reverseLookup(t, r, emptyID)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(0), total)
	assert.Empty(t, list, "无引用返回空 list 而非 null")

	// 标签模板不存在 → not_found。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/ci-exporter-mappings?label_template_id=999999", "")
	assert.Equal(t, http.StatusNotFound, w.Code, "模板不存在返 not_found")
	assert.Contains(t, w.Body.String(), "not_found")
}

// TestListCITypeExporterMappingsByLabelTemplateSoftDeleted 锁定「软删记录不计入
// 引用」口径（PRD §6.6.3.1）：软删行由 GORM 自动过滤，不计入 total。
func TestListCITypeExporterMappingsByLabelTemplateSoftDeleted(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	ltID := strconv.FormatUint(uint64(seedLabelTemplate(t, db, "tpl", "database")), 10)

	alive := seedMappingWithLabelTemplate(t, db, "mysql", "mysql-exporter", ltID, false, false)
	removed := seedMappingWithLabelTemplate(t, db, "redis", "redis-exporter", ltID, false, false)
	require.NoError(t, db.Delete(removed).Error) // 软删

	code, list, total := reverseLookup(t, r, ltID)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), total, "软删映射行不计入引用")
	require.Len(t, list, 1)
	assert.Equal(t, alive.MonitorType, list[0].MonitorType)
}

// TestListCITypeExporterMappingsByLabelTemplateDisabledJobStillCounts 锁定决策 119
// 的核心口径「停用引用同样计入」：enabled=false 的采集 Job 仍绑定该模板时，
// CI 侧反查照常返回该映射行（引用存在 → M07 禁删模板）。
//
// 注：CITypeExporterMapping 本身无 enabled 字段（停用语义属 ScrapeJob），
// 故此处以「引用方的 Job 处于停用态」构造场景，断言反查不因 Job 停用而漏计。
func TestListCITypeExporterMappingsByLabelTemplateDisabledJobStillCounts(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	ltID := strconv.FormatUint(uint64(seedLabelTemplate(t, db, "tpl", "database")), 10)
	m := seedMappingWithLabelTemplate(t, db, "mysql", "mysql-exporter", ltID, false, false)

	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "mysql-stopped", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeDatabase,
		MonitorType: "mysql", ExporterTemplateID: m.ExporterTemplateID, NetworkDomainID: "default",
		InstanceSelectionMode: models.InstanceSelectionManual, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusNone, LabelTemplateID: ltID, Enabled: false, // 停用
	}).Error)

	code, list, total := reverseLookup(t, r, ltID)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, int64(1), total, "停用 Job 引用不导致反查漏计")
	require.Len(t, list, 1)
	assert.Equal(t, m.MonitorType, list[0].MonitorType)
}

// TestListCITypeExporterMappingsReverseLookupKeepsListMode 反查为新增模式，
// 不得破坏既有列表调用的分页与筛选行为。
func TestListCITypeExporterMappingsReverseLookupKeepsListMode(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	ltID := strconv.FormatUint(uint64(seedLabelTemplate(t, db, "tpl", "database")), 10)
	seedMappingWithLabelTemplate(t, db, "mysql", "mysql-exporter", ltID, false, false)

	// 不带 label_template_id → 仍走既有分页列表形态。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/ci-exporter-mappings?page=1&page_size=10", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List     []mappingListItem `json:"list"`
			Total    int64             `json:"total"`
			Page     int               `json:"page"`
			PageSize int               `json:"page_size"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, 10, out.Data.PageSize, "分页参数仍生效")
	assert.Equal(t, 1, out.Data.Page)
	require.Len(t, out.Data.List, 1)
	assert.True(t, out.Data.List[0].HasLabelTemplate, "列表模式仍返回 has_label_template 派生字段")
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
// seedExporterWithTypes persists an exporter declaring supported monitor types.
func seedExporterWithTypes(t *testing.T, db *gorm.DB, name string, types ...string) string {
	t.Helper()
	e := &models.ExporterTemplate{
		Name: name, MetricsPath: "/metrics", Scheme: "http",
		Source: models.ExporterSourceInternal, SupportedMonitorTypes: types,
	}
	require.NoError(t, db.Create(e).Error)
	return strconv.FormatUint(uint64(e.ID), 10)
}

// TestMappingExporterSupportTypeGuard 覆盖 F-27 C：采集器 supported_monitor_types
// 非空时，建/改映射的 monitor_type 须在声明范围内；未标注（空）放行。
func TestMappingExporterSupportTypeGuard(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	mysqlOnly := seedExporterWithTypes(t, db, "mysqld-custom", "mysql")
	untyped := seedExporterWithID(t, db, "generic-exporter")

	// 声明仅支持 mysql 的采集器绑到 redis → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings",
		fmt.Sprintf(`{"monitor_type":"redis","exporter_template_id":"%s","metrics_path":"/metrics","scheme":"http"}`, mysqlOnly))
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "supported_monitor_types")

	// 类型匹配 → 放行。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings",
		fmt.Sprintf(`{"monitor_type":"mysql","exporter_template_id":"%s","metrics_path":"/metrics","scheme":"http"}`, mysqlOnly))
	require.Equal(t, http.StatusOK, w.Code)
	var created struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))

	// 未标注支持类型的采集器 → 放行（兼容存量）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/ci-exporter-mappings",
		fmt.Sprintf(`{"monitor_type":"redis","exporter_template_id":"%s","metrics_path":"/metrics","scheme":"http"}`, untyped))
	require.Equal(t, http.StatusOK, w.Code)

	// 更新路径：把 mysql 映射改成 redis（采集器不支持）→ bad_request。
	w = perform(t, r, http.MethodPut,
		fmt.Sprintf("/api/v2/platform/ci-exporter-mappings/%d", created.Data.ID), `{"monitor_type":"redis"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "supported_monitor_types")
}
