package label

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
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// openCRUDTestDB 打开独立的内存 SQLite，迁移 LabelTemplate 与
// LabelTemplateSnapshot 两张表（CRUD / clone 测试所需）。
func openCRUDTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:label_crud_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.LabelTemplate{},
		&models.LabelTemplateSnapshot{},
	))
	return db
}

// mountCRUD 挂载本任务实现的 CRUD + clone handler（路由正式收口在 T07-18）。
func mountCRUD(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	r.POST("/api/v2/platform/label-templates", CreateLabelTemplate(db))
	r.PUT("/api/v2/platform/label-templates/:template_id", UpdateLabelTemplate(db))
	r.DELETE("/api/v2/platform/label-templates/:template_id", DeleteLabelTemplate(db))
	r.POST("/api/v2/platform/label-templates/:template_id/clone", CloneLabelTemplate(db))
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

	body := `{"name":"custom-host","resource_category":"host","mappings":[{"source_field":"app_name","source_type":"resource_field","target_label":"app","enabled":true}]}`
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
		{"source_field":"app_name","source_type":"resource_field","target_label":"app","enabled":true},
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
	assert.Contains(t, e.Error, "append label template snapshot")

	var n int64
	require.NoError(t, db.Model(&models.LabelTemplate{}).Count(&n).Error)
	assert.Zero(t, n, "快照写入失败时模板创建必须回滚")
}
