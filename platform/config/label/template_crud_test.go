package label

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
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// openCRUDTestDB 打开独立的内存 SQLite，迁移 LabelTemplate 与
// LabelTemplateSnapshot 两张表（CRUD / clone 测试所需）。
//
// 同时迁移 ScrapeJob 与 CITypeExporterMapping：删除引用保护需要读这两张表
// （M01 拥有，M07 只读消费），不迁移会导致查询报「no such table」。
func openCRUDTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:label_crud_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.LabelTemplate{},
		&models.LabelTemplateSnapshot{},
		&models.ScrapeJob{},
		&models.CITypeExporterMapping{},
	))
	return db
}

// mountCRUD 挂载本任务实现的 CRUD + clone handler（路由正式收口在 T07-18）。
// DELETE 传入与生产装配同源的引用清单数据源（NewTemplateReferenceSource），
// 保证测试覆盖的判定口径与运行时一致。
func mountCRUD(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	refSource := NewTemplateReferenceSource(db)
	r.POST("/api/v2/platform/label-templates", CreateLabelTemplate(db))
	r.PUT("/api/v2/platform/label-templates/:template_id", UpdateLabelTemplate(db))
	r.DELETE("/api/v2/platform/label-templates/:template_id", DeleteLabelTemplate(db, refSource))
	r.POST("/api/v2/platform/label-templates/:template_id/clone", CloneLabelTemplate(db))
	r.GET("/api/v2/platform/label-templates/:template_id/references", ListTemplateReferences(db, refSource))
	return r
}

// doJSON 以给定方法/路径执行请求；body 为空时发送无请求体请求。
func doJSON(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Reader
	if body == "" {
		buf = bytes.NewReader(nil)
	} else {
		buf = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, buf)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// decodeTemplate 解析成功响应的 data（完整 LabelTemplate）。
func decodeTemplate(t *testing.T, w *httptest.ResponseRecorder) (int, models.LabelTemplate) {
	t.Helper()
	var out struct {
		Status string               `json:"status"`
		Data   models.LabelTemplate `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out.Data
}

// decodeTemplateID 解析删除响应的 data.template_id。
func decodeTemplateID(t *testing.T, w *httptest.ResponseRecorder) (int, uint) {
	t.Helper()
	var out struct {
		Status string `json:"status"`
		Data   struct {
			TemplateID uint `json:"template_id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out.Data.TemplateID
}

// decodeErr 解析错误响应的 {status, errorType, error}。
func decodeErr(t *testing.T, w *httptest.ResponseRecorder) (int, response.Response) {
	t.Helper()
	var out response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

// decodeForbidden 解析 403 被引用禁删响应：信封字段 + data.{reason, refs, total}。
// data 内 refs 的完整结构（source/id/name/network_domain_id/enabled）是本决策的
// 契约核心，故此处按结构体解析而非仅取 total。
func decodeForbidden(t *testing.T, w *httptest.ResponseRecorder) (int, response.Response, referencedData) {
	t.Helper()
	var out struct {
		Status    string         `json:"status"`
		ErrorType string         `json:"errorType"`
		Error     string         `json:"error"`
		Data      referencedData `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, response.Response{Status: out.Status, ErrorType: out.ErrorType, Error: out.Error}, out.Data
}

// referencedData 是 403 / GET /references 响应 data 的结构。
type referencedData struct {
	Reason string              `json:"reason"`
	Refs   []TemplateReference `json:"refs"`
	Total  int                 `json:"total"`
}

// decodeRefs 解析 GET /references 的 data.{refs, total}。
func decodeRefs(t *testing.T, w *httptest.ResponseRecorder) (int, referencedData) {
	t.Helper()
	var out struct {
		Status string         `json:"status"`
		Data   referencedData `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out.Data
}

// seedReferencingJob 造一条引用 labelTemplateID 的采集 Job。enabled 显式入参，
// 用于覆盖「停用引用同样禁删」口径。
func seedReferencingJob(t *testing.T, db *gorm.DB, labelTemplateID uint, name string, enabled bool) *models.ScrapeJob {
	t.Helper()
	job := &models.ScrapeJob{
		JobName:               name,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       "nd-1",
		InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval:        models.DefaultScrapeInterval,
		ScrapeTimeout:         models.DefaultScrapeTimeout,
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusNone,
		Enabled:               enabled,
		LabelTemplateID:       strconv.FormatUint(uint64(labelTemplateID), 10),
	}
	require.NoError(t, db.Create(job).Error)
	return job
}

// seedReferencingMapping 造一条引用 labelTemplateID 的 CI 类型映射。
func seedReferencingMapping(t *testing.T, db *gorm.DB, labelTemplateID uint, monitorType string) *models.CITypeExporterMapping {
	t.Helper()
	m := &models.CITypeExporterMapping{
		MonitorType:        monitorType,
		ExporterTemplateID: "tpl-1",
		MetricsPath:        "/metrics",
		Scheme:             "http",
		ScrapeInterval:     models.DefaultScrapeInterval,
		ScrapeTimeout:      models.DefaultScrapeTimeout,
		LabelTemplateID:    strconv.FormatUint(uint64(labelTemplateID), 10),
	}
	require.NoError(t, db.Create(m).Error)
	return m
}

// newReferencedTemplate 建一个非默认模板并返回（引用保护用例的被删对象）。
func newReferencedTemplate(t *testing.T, r *gin.Engine, name string) models.LabelTemplate {
	t.Helper()
	code, tmpl := decodeTemplate(t, doJSON(t, r, http.MethodPost,
		"/api/v2/platform/label-templates", fmt.Sprintf(`{"name":%q,"resource_category":"host"}`, name)))
	require.Equal(t, http.StatusOK, code)
	return tmpl
}

func countSnapshots(t *testing.T, db *gorm.DB, templateID uint) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.LabelTemplateSnapshot{}).Where("template_id = ?", templateID).Count(&n).Error)
	return n
}

// lastSnapshot 取某模板最近一条快照（按 id 倒序）。
func lastSnapshot(t *testing.T, db *gorm.DB, templateID uint) models.LabelTemplateSnapshot {
	t.Helper()
	var snap models.LabelTemplateSnapshot
	require.NoError(t, db.Where("template_id = ?", templateID).Order("id desc").First(&snap).Error)
	return snap
}

func TestCreateLabelTemplateSuccess(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)

	body := `{"name":"custom-host","resource_category":"host","mappings":[{"source_field":"app_code","source_type":"resource_field","target_label":"app","enabled":true}]}`
	w := doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", body)
	code, tmpl := decodeTemplate(t, w)
	require.Equal(t, http.StatusOK, code)
	assert.False(t, tmpl.IsDefault, "创建模板必须 is_default=false")
	assert.Equal(t, "custom-host", tmpl.Name)
	assert.Equal(t, models.ResourceCategoryHost, tmpl.ResourceCategory)
	require.Len(t, tmpl.Mappings, 1)
	assert.Equal(t, "app", tmpl.Mappings[0].TargetLabel)
	assert.True(t, tmpl.Mappings[0].Enabled)

	// create 落快照：operator=platform_admin，changed_mappings 记录新建映射 NewValue。
	assert.Equal(t, int64(1), countSnapshots(t, db, tmpl.ID))
	snap := lastSnapshot(t, db, tmpl.ID)
	assert.Equal(t, models.PlatformAdminTenantID, snap.Operator)
	require.Len(t, snap.ChangedMappings, 1)
	assert.Equal(t, "app", snap.ChangedMappings[0].TargetLabel)
	assert.Nil(t, snap.ChangedMappings[0].OldValue, "新建映射 OldValue 为空")
	require.NotNil(t, snap.ChangedMappings[0].NewValue, "新建映射 NewValue 有值")
	assert.Equal(t, "app", snap.ChangedMappings[0].NewValue.TargetLabel)
}

func TestCreateLabelTemplateDuplicateConflict(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	body := `{"name":"dup-host","resource_category":"host"}`
	code, _ := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", body))
	require.Equal(t, http.StatusOK, code)

	// 同名同类型 → conflict。
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", body))
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, response.ErrorTypeConflict, e.ErrorType)

	// 同名不同类型可创建。
	code, tmpl := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"dup-host","resource_category":"database"}`))
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, models.ResourceCategoryDatabase, tmpl.ResourceCategory)
}

func TestCreateLabelTemplateValidation(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)

	// name 为空。
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"","resource_category":"host"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)

	// resource_category 非法。
	code, _ = decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"x","resource_category":"unknown"}`))
	assert.Equal(t, http.StatusBadRequest, code)

	// mappings 基础校验：target_label 为空（T07-16 将增强完整规则）。
	code, _ = decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"x","resource_category":"host","mappings":[{"source_type":"resource_field","target_label":""}]}`))
	assert.Equal(t, http.StatusBadRequest, code)
}

func TestUpdateLabelTemplateSuccess(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	_, created := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"old-name","resource_category":"host"}`))

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", created.ID)
	code, updated := decodeTemplate(t, doJSON(t, r, http.MethodPut, path, `{"name":"new-name"}`))
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "new-name", updated.Name)
	assert.Equal(t, models.ResourceCategoryHost, updated.ResourceCategory, "resource_category 不应被更新")
	assert.Equal(t, created.ID, updated.ID)

	// update 落快照（mappings 无变更，changed_mappings 为空）。
	assert.Equal(t, int64(2), countSnapshots(t, db, created.ID))
	snap := lastSnapshot(t, db, created.ID)
	assert.Equal(t, models.PlatformAdminTenantID, snap.Operator)
	assert.Empty(t, snap.ChangedMappings)
}

func TestUpdateLabelTemplateResourceCategoryImmutable(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	_, created := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"immutable-cat","resource_category":"host"}`))

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", created.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPut, path, `{"resource_category":"database"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)

	// DB 中 resource_category 未被改动。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, created.ID).Error)
	assert.Equal(t, models.ResourceCategoryHost, got.ResourceCategory)
	assert.Equal(t, "immutable-cat", got.Name)
}

func TestUpdateLabelTemplateNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPut, "/api/v2/platform/label-templates/99999", `{"name":"x"}`))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

func TestDeleteLabelTemplateSuccess(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	_, created := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"doomed","resource_category":"host","mappings":[{"source_field":"env","source_type":"resource_field","target_label":"env","enabled":true}]}`))

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", created.ID)
	code, id := decodeTemplateID(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, created.ID, id)

	// 软删：普通查询不可见，Unscoped 可见且 deleted_at 置位。
	var active models.LabelTemplate
	err := db.First(&active, created.ID).Error
	assert.ErrorIs(t, err, gorm.ErrRecordNotFound, "软删模板不应被普通查询命中")
	var raw models.LabelTemplate
	require.NoError(t, db.Unscoped().First(&raw, created.ID).Error)
	assert.True(t, raw.DeletedAt.Valid, "软删应置位 deleted_at")

	// delete 落快照：changed_mappings 记录移除映射 OldValue。
	snap := lastSnapshot(t, db, created.ID)
	require.Len(t, snap.ChangedMappings, 1)
	assert.Nil(t, snap.ChangedMappings[0].NewValue, "移除映射 NewValue 为空")
	require.NotNil(t, snap.ChangedMappings[0].OldValue, "移除映射 OldValue 有值")
	assert.Equal(t, "env", snap.ChangedMappings[0].OldValue.TargetLabel)
}

func TestDeleteLabelTemplateDefaultForbidden(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	def := &models.LabelTemplate{
		Name:             "default-host",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryHost),
	}
	require.NoError(t, db.Create(def).Error)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", def.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)
	assert.Contains(t, e.Error, "默认模板禁止删除")

	// 默认模板未被软删。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, def.ID).Error)
	assert.True(t, got.IsDefault)
}

func TestDeleteLabelTemplateNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, "/api/v2/platform/label-templates/99999", ""))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

func TestCloneLabelTemplate(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	srcBody := `{"name":"base-host","resource_category":"host","mappings":[
		{"source_field":"app_code","source_type":"resource_field","target_label":"app","enabled":true},
		{"source_field":"instance_ip:port","source_type":"composite","target_label":"instance","enabled":true}
	]}`
	_, src := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", srcBody))
	require.Len(t, src.Mappings, 2)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/clone", src.ID)
	code, clone := decodeTemplate(t, doJSON(t, r, http.MethodPost, path, ""))
	require.Equal(t, http.StatusOK, code)
	assert.False(t, clone.IsDefault, "克隆模板必须 is_default=false")
	assert.Equal(t, src.ResourceCategory, clone.ResourceCategory)
	assert.NotEqual(t, src.ID, clone.ID, "克隆应生成新模板")
	require.Len(t, clone.Mappings, 2, "克隆应复制全部 mappings")
	assert.Equal(t, "app", clone.Mappings[0].TargetLabel)
	assert.Equal(t, "instance", clone.Mappings[1].TargetLabel)
	assert.True(t, clone.Mappings[0].Enabled)
	assert.Equal(t, "instance_ip:port", clone.Mappings[1].SourceField)

	// 源模板未被改动。
	var srcReload models.LabelTemplate
	require.NoError(t, db.First(&srcReload, src.ID).Error)
	require.Len(t, srcReload.Mappings, 2)

	// clone 落快照（含复制 mappings 的 NewValue）。
	assert.Equal(t, int64(1), countSnapshots(t, db, clone.ID))
	snap := lastSnapshot(t, db, clone.ID)
	require.Len(t, snap.ChangedMappings, 2)
	require.NotNil(t, snap.ChangedMappings[0].NewValue)
	assert.Equal(t, "app", snap.ChangedMappings[0].NewValue.TargetLabel)
}

func TestCloneLabelTemplateNameOverride(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	_, src := decodeTemplate(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"base-host","resource_category":"host"}`))

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/clone", src.ID)
	code, clone := decodeTemplate(t, doJSON(t, r, http.MethodPost, path, `{"name":"cloned-host"}`))
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "cloned-host", clone.Name)
	assert.False(t, clone.IsDefault)
}

func TestCloneLabelTemplateNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates/99999/clone", ""))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

// openRollbackTestDB 打开内存 SQLite 但只迁移 LabelTemplate、不迁移
// LabelTemplateSnapshot，用于制造「快照写入失败」以验证事务回滚（dev-feedback L-1）。
func openRollbackTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:label_rollback_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.LabelTemplate{}))
	return db
}

// TestCreateLabelTemplateRollbackOnSnapshotFailure 验证模板创建与快照写入同事务
// （dev-feedback L-1）：快照表缺失导致 appendTemplateSnapshot 失败时，返回 500
// 且模板创建一并回滚（不残留无快照的模板）。
func TestCreateLabelTemplateRollbackOnSnapshotFailure(t *testing.T) {
	db := openRollbackTestDB(t)
	r := mountCRUD(t, db)

	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates", `{"name":"rollback-host","resource_category":"host"}`))
	require.Equal(t, http.StatusInternalServerError, code, "快照写入失败应返回 500：%s", e.Error)
	// security：内部错误不回显明细，仅返回通用文案。
	assert.Equal(t, "internal error", e.Error)

	var n int64
	require.NoError(t, db.Model(&models.LabelTemplate{}).Count(&n).Error)
	assert.Zero(t, n, "快照写入失败时模板创建必须回滚")
}

// ---------------------------------------------------------------------------
// 删除引用保护（Module_07 §6.6.3.1）
// ---------------------------------------------------------------------------

// TestDeleteLabelTemplateForbiddenByScrapeJob 覆盖：被采集 Job 引用 → 403
// forbidden，data 回传 reason=referenced 与含该 Job 的 refs。
func TestDeleteLabelTemplateForbiddenByScrapeJob(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "job-referenced")
	job := seedReferencingJob(t, db, tmpl.ID, "node-exporter-1", true)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, env, data := decodeForbidden(t, doJSON(t, r, http.MethodDelete, path, ""))

	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, response.ErrorTypeForbidden, env.ErrorType)
	assert.Equal(t, "referenced", data.Reason)
	assert.Equal(t, 1, data.Total)
	require.Len(t, data.Refs, 1)
	assert.Equal(t, RefSourceScrapeJob, data.Refs[0].Source)
	assert.Equal(t, job.ID, data.Refs[0].ID)
	assert.Equal(t, "node-exporter-1", data.Refs[0].Name)
	assert.Equal(t, "nd-1", data.Refs[0].NetworkDomainID)
	require.NotNil(t, data.Refs[0].Enabled)
	assert.True(t, *data.Refs[0].Enabled)

	// 文案须引导「先改绑或删除引用方」，不能只丢错误码（§6.6.3.1 第 4 点）。
	assert.Contains(t, env.Error, "禁止删除")
	assert.Contains(t, env.Error, "改绑或删除引用方")

	// 模板未被软删，且未落删除快照。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error)
	assert.Zero(t, countSnapshots(t, db, tmpl.ID)-1, "被引用拒删时不应新增删除快照")
}

// TestDeleteLabelTemplateForbiddenByDisabledScrapeJob 覆盖本次拍板核心口径：
// 停用（enabled=false）的 Job 引用**同样阻塞删除**。理由是停用 Job 可随时原地
// 复用、其 target 配置仍留在已下发的 prometheus.yml 中未回收，删模板会让「恢复
// 启用」在无感知的情况下换掉 label 集。
func TestDeleteLabelTemplateForbiddenByDisabledScrapeJob(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "disabled-job-referenced")
	job := seedReferencingJob(t, db, tmpl.ID, "paused-job", false)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, env, data := decodeForbidden(t, doJSON(t, r, http.MethodDelete, path, ""))

	assert.Equal(t, http.StatusForbidden, code, "停用 Job 引用同样禁删，不得放行")
	assert.Equal(t, response.ErrorTypeForbidden, env.ErrorType)
	assert.Equal(t, 1, data.Total)
	require.Len(t, data.Refs, 1)
	assert.Equal(t, job.ID, data.Refs[0].ID)
	require.NotNil(t, data.Refs[0].Enabled)
	assert.False(t, *data.Refs[0].Enabled, "enabled 应如实回传 false")
	assert.Contains(t, env.Error, "停用", "文案应提示停用不解除引用，避免用户误以为停用即可绕过")

	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error, "停用引用时模板不得被软删")
}

// TestDeleteLabelTemplateForbiddenByCIMapping 覆盖：被 CI 类型映射引用 → 403。
func TestDeleteLabelTemplateForbiddenByCIMapping(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "ci-referenced")
	m := seedReferencingMapping(t, db, tmpl.ID, "mysql")

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, env, data := decodeForbidden(t, doJSON(t, r, http.MethodDelete, path, ""))

	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, response.ErrorTypeForbidden, env.ErrorType)
	assert.Equal(t, "referenced", data.Reason)
	assert.Equal(t, 1, data.Total)
	require.Len(t, data.Refs, 1)
	assert.Equal(t, RefSourceCIMapping, data.Refs[0].Source)
	assert.Equal(t, m.ID, data.Refs[0].ID)
	assert.Equal(t, "mysql", data.Refs[0].MonitorType)
	assert.Nil(t, data.Refs[0].Enabled, "CI 映射无 enabled 语义")
	assert.Contains(t, env.Error, "CI 类型映射")

	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error)
}

// TestDeleteLabelTemplateForbiddenMergesBothSources 覆盖：两表同时引用 → 403，
// 且 refs 是**合并后的完整清单**（含来源标识，便于定位要解绑哪些对象）。
func TestDeleteLabelTemplateForbiddenMergesBothSources(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "both-referenced")
	seedReferencingJob(t, db, tmpl.ID, "job-a", true)
	seedReferencingMapping(t, db, tmpl.ID, "redis")

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, _, data := decodeForbidden(t, doJSON(t, r, http.MethodDelete, path, ""))

	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, 2, data.Total, "两侧引用须合并计数")
	require.Len(t, data.Refs, 2)

	sources := map[string]TemplateReference{}
	for _, ref := range data.Refs {
		sources[ref.Source] = ref
	}
	require.Contains(t, sources, RefSourceScrapeJob)
	require.Contains(t, sources, RefSourceCIMapping)
	assert.Equal(t, "job-a", sources[RefSourceScrapeJob].Name)
	assert.Equal(t, "redis", sources[RefSourceCIMapping].Name)
}

// TestDeleteLabelTemplateSoftDeletedRefsDoNotBlock 覆盖：软删（deleted_at 非空）
// 的 Job / 映射不构成引用、不阻塞删除（§6.6.3.1 第 2 点）。
func TestDeleteLabelTemplateSoftDeletedRefsDoNotBlock(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "soft-deleted-refs")

	job := seedReferencingJob(t, db, tmpl.ID, "gone-job", true)
	require.NoError(t, db.Delete(&models.ScrapeJob{}, job.ID).Error)
	m := seedReferencingMapping(t, db, tmpl.ID, "mysql")
	require.NoError(t, db.Delete(&models.CITypeExporterMapping{}, m.ID).Error)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, id := decodeTemplateID(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusOK, code, "软删引用不构成引用，不应阻塞删除")
	assert.Equal(t, tmpl.ID, id)
}

// TestDeleteLabelTemplateDefaultTemplateChecksBeforeReferences 覆盖：默认模板
// 仍走 bad_request，不被引用校验抢先（两者语义分离，§6.6.3.1 第 3 点）。
// 该默认模板同时挂引用，用于证明「默认模板」判定优先于「被引用」判定。
func TestDeleteLabelTemplateDefaultTemplateChecksBeforeReferences(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	def := &models.LabelTemplate{
		Name:             "default-host-referenced",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryHost),
	}
	require.NoError(t, db.Create(def).Error)
	seedReferencingJob(t, db, def.ID, "job-on-default", true)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", def.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusBadRequest, code, "默认模板禁删是自身属性约束，应先于引用校验")
	assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)
	assert.Contains(t, e.Error, "默认模板禁止删除")

	var got models.LabelTemplate
	require.NoError(t, db.First(&got, def.ID).Error)
	assert.True(t, got.IsDefault)
}

// TestDeleteLabelTemplateConservativeOnSourceFailure 覆盖：引用数据源查询失败时
// **保守拒绝**（500）而非放行删除。查不到引用 ≠ 没有引用；放行会让删除继续、
// 制造静默漂移，正是本决策要防的失败模式。
func TestDeleteLabelTemplateConservativeOnSourceFailure(t *testing.T) {
	db := openCRUDTestDB(t)
	tmpl := newReferencedTemplate(t, mountCRUD(t, db), "source-failure")

	// 故障数据源：无论模板是否被引用，一律返回错误。
	r := newGin()
	failing := TemplateReferenceSourceFunc(func(uint) ([]TemplateReference, error) {
		return nil, fmt.Errorf("模拟数据源不可用")
	})
	r.DELETE("/api/v2/platform/label-templates/:template_id", DeleteLabelTemplate(db, failing))

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusInternalServerError, code, "数据源失败必须保守拒绝，不得放行删除")
	assert.Equal(t, response.ErrorTypeInternal, e.ErrorType)

	// 关键：模板确实未被删除。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error, "数据源失败时模板不得被软删")
}

// TestDeleteLabelTemplateNilSourceFailsClosed 覆盖：引用数据源未装配（nil）时
// **保守拒绝**而非静默跳过校验。装配遗漏若被当作「无引用」放行，等于放任静默漂移。
func TestDeleteLabelTemplateNilSourceFailsClosed(t *testing.T) {
	db := openCRUDTestDB(t)
	tmpl := newReferencedTemplate(t, mountCRUD(t, db), "nil-source")

	r := newGin()
	r.DELETE("/api/v2/platform/label-templates/:template_id", DeleteLabelTemplate(db, nil))

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d", tmpl.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusInternalServerError, code, "数据源未装配必须拒绝，不得静默放行")
	assert.Equal(t, response.ErrorTypeInternal, e.ErrorType)

	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error, "数据源未装配时模板不得被软删")
}

// TestListTemplateReferencesAggregation 覆盖 GET /references：聚合两侧清单，
// 无引用返回空 refs + total=0（空切片序列化为 [] 而非 null）。
func TestListTemplateReferencesAggregation(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "refs-aggregate")
	seedReferencingJob(t, db, tmpl.ID, "job-1", true)
	seedReferencingMapping(t, db, tmpl.ID, "mysql")

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/references", tmpl.ID)
	code, data := decodeRefs(t, doJSON(t, r, http.MethodGet, path, ""))
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, 2, data.Total)
	require.Len(t, data.Refs, 2)

	bySource := map[string]TemplateReference{}
	for _, ref := range data.Refs {
		bySource[ref.Source] = ref
	}
	assert.Equal(t, "job-1", bySource[RefSourceScrapeJob].Name)
	assert.Equal(t, "nd-1", bySource[RefSourceScrapeJob].NetworkDomainID)
	assert.Equal(t, "mysql", bySource[RefSourceCIMapping].MonitorType)
}

// TestListTemplateReferencesEmptyAndNotFound 覆盖：无引用返回空清单而非报错；
// 模板不存在返回 not_found。
func TestListTemplateReferencesEmptyAndNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "refs-empty")

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/references", tmpl.ID)
	code, data := decodeRefs(t, doJSON(t, r, http.MethodGet, path, ""))
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, 0, data.Total)
	assert.NotNil(t, data.Refs, "refs 应为空数组而非 null")
	assert.Empty(t, data.Refs)
	assert.Contains(t, string(doJSON(t, r, http.MethodGet, path, "").Body.Bytes()), `"refs":[]`)

	code, e := decodeErr(t, doJSON(t, r, http.MethodGet, "/api/v2/platform/label-templates/99999/references", ""))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

// TestListTemplateReferencesExcludesSoftDeleted 覆盖：软删行不进入引用清单。
func TestListTemplateReferencesExcludesSoftDeleted(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountCRUD(t, db)
	tmpl := newReferencedTemplate(t, r, "refs-soft-deleted")

	alive := seedReferencingJob(t, db, tmpl.ID, "alive-job", true)
	dead := seedReferencingJob(t, db, tmpl.ID, "dead-job", true)
	require.NoError(t, db.Delete(&models.ScrapeJob{}, dead.ID).Error)
	aliveMapping := seedReferencingMapping(t, db, tmpl.ID, "mysql")
	deadMapping := seedReferencingMapping(t, db, tmpl.ID, "redis")
	require.NoError(t, db.Delete(&models.CITypeExporterMapping{}, deadMapping.ID).Error)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/references", tmpl.ID)
	code, data := decodeRefs(t, doJSON(t, r, http.MethodGet, path, ""))
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, 2, data.Total, "仅存活的两条计入引用")

	names := make([]string, 0, len(data.Refs))
	ids := make([]uint, 0, len(data.Refs))
	for _, ref := range data.Refs {
		names = append(names, ref.Name)
		ids = append(ids, ref.ID)
	}
	assert.ElementsMatch(t, []string{"alive-job", "mysql"}, names)
	assert.ElementsMatch(t, []uint{alive.ID, aliveMapping.ID}, ids)
}
