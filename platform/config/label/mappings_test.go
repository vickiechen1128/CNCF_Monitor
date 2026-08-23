// 本文件覆盖 LabelTemplate mappings CRUD 接口
// （POST/PUT/DELETE /api/v2/platform/label-templates/:template_id/mappings[/:mapping_id]）
// 与增强后的 validateMappings，见 Module_07 §5.11 / §6.3 / §6.6.3 / §9.2。
package label

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// mountMappings 挂载本任务实现的 mappings handler（路由正式收口在 T07-18）。
func mountMappings(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	r.POST("/api/v2/platform/label-templates/:template_id/mappings", CreateLabelMapping(db))
	r.PUT("/api/v2/platform/label-templates/:template_id/mappings/:mapping_id", UpdateLabelMapping(db))
	r.DELETE("/api/v2/platform/label-templates/:template_id/mappings/:mapping_id", DeleteLabelMapping(db))
	return r
}

// decodeMappings 解析成功响应的 data（更新后的 mappings 列表）。
func decodeMappings(t *testing.T, w *httptest.ResponseRecorder) (int, []models.LabelMapping) {
	t.Helper()
	var out struct {
		Status string                `json:"status"`
		Data   []models.LabelMapping `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out.Data
}

// decodeMappingID 解析删除响应的 data.mapping_id。
func decodeMappingID(t *testing.T, w *httptest.ResponseRecorder) (int, uint) {
	t.Helper()
	var out struct {
		Status string `json:"status"`
		Data   struct {
			MappingID uint `json:"mapping_id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out.Data.MappingID
}

// seedMappingTemplate 直接落库一个自定义（is_default=false）模板，含一条
// resource_field 映射（app_name→app），供 mappings 用例使用。
func seedMappingTemplate(t *testing.T, db *gorm.DB) models.LabelTemplate {
	t.Helper()
	tmpl := &models.LabelTemplate{
		Name:             "mapping-host",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        false,
		Mappings: []models.LabelMapping{
			{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
		},
	}
	require.NoError(t, db.Create(tmpl).Error)
	return *tmpl
}

// seedDefaultMappingTemplate 直接落库一个默认（is_default=true）模板。
func seedDefaultMappingTemplate(t *testing.T, db *gorm.DB) models.LabelTemplate {
	t.Helper()
	tmpl := &models.LabelTemplate{
		Name:             "default-host",
		ResourceCategory: models.ResourceCategoryHost,
		IsDefault:        true,
		Mappings:         models.DefaultMappingBuilders(models.ResourceCategoryHost),
	}
	require.NoError(t, db.Create(tmpl).Error)
	return *tmpl
}

// assertMappingsTargets 断言 mappings 的目标标签集合（用于校验返回值）。
func assertMappingsTargets(t *testing.T, mappings []models.LabelMapping, want ...string) {
	t.Helper()
	got := make([]string, 0, len(mappings))
	for _, m := range mappings {
		got = append(got, m.TargetLabel)
	}
	assert.ElementsMatch(t, want, got)
}

// ============================ POST 新增映射 ============================

func TestCreateLabelMappingResourceFieldDefaultPrefill(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	// 不传 target_label：resource_field 默认预填为 source_field（§5.11）。
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"env","enabled":true}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 2)
	assertMappingsTargets(t, mappings, "app", "env")
	// 新增映射 enabled 默认 true。
	for _, m := range mappings {
		assert.True(t, m.Enabled)
	}
	assert.Equal(t, "env", mappings[1].TargetLabel)
	assert.Equal(t, "env", mappings[1].SourceField)

	// 落快照：新增映射 NewValue 有值、OldValue 为空。
	assert.Equal(t, int64(1), countSnapshots(t, db, tmpl.ID))
	snap := lastSnapshot(t, db, tmpl.ID)
	require.Len(t, snap.ChangedMappings, 1)
	assert.Equal(t, "env", snap.ChangedMappings[0].TargetLabel)
	assert.Nil(t, snap.ChangedMappings[0].OldValue)
	require.NotNil(t, snap.ChangedMappings[0].NewValue)
	assert.Equal(t, "env", snap.ChangedMappings[0].NewValue.TargetLabel)
}

func TestCreateLabelMappingExplicitTarget(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"biz_code","target_label":"biz","enabled":true}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 2)
	assertMappingsTargets(t, mappings, "app", "biz")
	assert.Equal(t, "biz", mappings[1].TargetLabel)
}

func TestCreateLabelMappingProtectedLabelRejected(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	// job 是保护 label → bad_request。
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"env","target_label":"job","enabled":true}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)
	assert.Contains(t, e.Error, "保护")

	// __name__ 是保护 label → bad_request。
	code, _ = decodeErr(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"env","target_label":"__name__","enabled":true}`))
	assert.Equal(t, http.StatusBadRequest, code)

	// 未落任何新快照/映射。
	require.Len(t, tmpl.Mappings, 1)
}

func TestCreateLabelMappingCompositeLocksInstance(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	// composite→instance 例外：通过，且 target_label 强制锁定为 instance。
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"composite","source_field":"instance_ip:port","enabled":true}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 2)
	assertMappingsTargets(t, mappings, "app", "instance")
	assert.Equal(t, models.LabelSourceTypeComposite, mappings[1].SourceType)
	assert.Equal(t, "instance", mappings[1].TargetLabel)
	assert.Equal(t, "instance_ip:port", mappings[1].SourceField)

	// 另一模板：即便显式传其他 target_label（job）也被锁定为 instance（§5.11）。
	tmpl2 := seedMappingTemplate(t, db)
	path2 := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl2.ID)
	code, mappings = decodeMappings(t, doJSON(t, r, http.MethodPost, path2, `{"source_type":"composite","source_field":"instance_ip:port","target_label":"job","enabled":true}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 2)
	assert.Equal(t, "instance", mappings[1].TargetLabel, "composite 目标标签必须锁定为 instance")
}

func TestCreateLabelMappingDuplicateTargetLabelRejected(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db) // 已含 app

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"app_name","target_label":"app","enabled":true}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, response.ErrorTypeBadRequest, e.ErrorType)
	assert.Contains(t, e.Error, "重复")
}

func TestCreateLabelMappingTransformValidation(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)

	// 非法 transform_rule → bad_request。
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"os_type","target_label":"os_type","transform_rule":"lowerx"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "transform_rule")

	// 合法枚举：lower/upper/prefix/replace/空 均接受（§5.11，prefix/replace 为 P1 置灰但枚举接受）。
	// 每轮使用唯一 target_label，避免同模板唯一性校验干扰 transform 校验本身。
	for _, tc := range []struct {
		rule  string
		label string
	}{
		{"lower", "os_lower"},
		{"upper", "os_upper"},
		{"prefix", "os_prefix"},
		{"replace", "os_replace"},
		{"", "os_plain"},
	} {
		body := fmt.Sprintf(`{"source_type":"resource_field","source_field":"os_type","target_label":%q,"transform_rule":%q}`, tc.label, tc.rule)
		code, _ := decodeMappings(t, doJSON(t, r, http.MethodPost, path, body))
		assert.Equal(t, http.StatusOK, code, "transform_rule=%q 应被接受", tc.rule)
	}
}

func TestCreateLabelMappingInvalidSourceType(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)

	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"unknown","source_field":"env","target_label":"env"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "source_type")
}

func TestCreateLabelMappingTemplateNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, "/api/v2/platform/label-templates/99999/mappings", `{"source_type":"resource_field","source_field":"env","target_label":"env"}`))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

func TestCreateLabelMappingDefaultTemplateForbidden(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	def := seedDefaultMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", def.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"env","target_label":"env"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "默认模板")

	// 默认模板 mappings 未被改动。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, def.ID).Error)
	require.Len(t, got.Mappings, len(def.Mappings))
}

// ============================ PUT 编辑映射 ============================

func TestUpdateLabelMappingSuccess(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	// 编辑第 1 条（mapping_id=1）：app→app 改为 biz_code→biz 且 lower。
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", tmpl.ID)
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPut, path, `{"source_field":"biz_code","target_label":"biz","transform_rule":"lower"}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 1)
	assert.Equal(t, "biz", mappings[0].TargetLabel)
	assert.Equal(t, "biz_code", mappings[0].SourceField)
	assert.Equal(t, "lower", mappings[0].Transform)
	assert.True(t, mappings[0].Enabled)

	// 快照记录 OldValue + NewValue。
	assert.Equal(t, int64(1), countSnapshots(t, db, tmpl.ID))
	snap := lastSnapshot(t, db, tmpl.ID)
	require.Len(t, snap.ChangedMappings, 1)
	assert.Equal(t, "biz", snap.ChangedMappings[0].TargetLabel)
	require.NotNil(t, snap.ChangedMappings[0].OldValue)
	assert.Equal(t, "app", snap.ChangedMappings[0].OldValue.TargetLabel)
	require.NotNil(t, snap.ChangedMappings[0].NewValue)
	assert.Equal(t, "biz", snap.ChangedMappings[0].NewValue.TargetLabel)
	assert.Equal(t, "lower", snap.ChangedMappings[0].NewValue.Transform)
}

func TestUpdateLabelMappingExcludeSelfUniqueness(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)
	// 追加一条 app 之外的映射，避免编辑自身时触发误报。
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	_, _ = decodeMappings(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"env","target_label":"env","enabled":true}`))

	// 编辑自身（mapping_id=1，target_label=app 保持不变）不应命中唯一性校验。
	editPath := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", tmpl.ID)
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPut, editPath, `{"source_field":"app_name","target_label":"app","transform_rule":"upper"}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 2)
	assert.Equal(t, "app", mappings[0].TargetLabel)
	assert.Equal(t, "upper", mappings[0].Transform)
}

func TestUpdateLabelMappingDuplicateRejected(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings", tmpl.ID)
	_, _ = decodeMappings(t, doJSON(t, r, http.MethodPost, path, `{"source_type":"resource_field","source_field":"env","target_label":"env","enabled":true}`))

	// 把第 1 条改为 env（与第 2 条重复）→ bad_request。
	editPath := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", tmpl.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPut, editPath, `{"target_label":"env"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "重复")
}

func TestUpdateLabelMappingCompositeLocked(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	// 编辑第 1 条 source_type=composite → target_label 强制锁定为 instance。
	editPath := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", tmpl.ID)
	code, mappings := decodeMappings(t, doJSON(t, r, http.MethodPut, editPath, `{"source_type":"composite","source_field":"instance_ip:port"}`))
	require.Equal(t, http.StatusOK, code)
	require.Len(t, mappings, 1)
	assert.Equal(t, models.LabelSourceTypeComposite, mappings[0].SourceType)
	assert.Equal(t, "instance", mappings[0].TargetLabel, "composite 目标标签锁定为 instance")
}

func TestUpdateLabelMappingNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)

	// 模板不存在 → not_found。
	code, e := decodeErr(t, doJSON(t, r, http.MethodPut, "/api/v2/platform/label-templates/99999/mappings/1", `{"target_label":"x"}`))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)

	// mapping_id 越界 → not_found。
	tmpl := seedMappingTemplate(t, db) // 1 条映射
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/2", tmpl.ID)
	code, e = decodeErr(t, doJSON(t, r, http.MethodPut, path, `{"target_label":"x"}`))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

func TestUpdateLabelMappingDefaultTemplateForbidden(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	def := seedDefaultMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", def.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodPut, path, `{"target_label":"x"}`))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "默认模板")
}

// ============================ DELETE 删除映射 ============================

func TestDeleteLabelMappingSuccess(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	tmpl := seedMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", tmpl.ID)
	code, mid := decodeMappingID(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, uint(1), mid)

	// 落快照：移除映射 OldValue 有值、NewValue 为空。
	snap := lastSnapshot(t, db, tmpl.ID)
	require.Len(t, snap.ChangedMappings, 1)
	assert.Equal(t, "app", snap.ChangedMappings[0].TargetLabel)
	require.NotNil(t, snap.ChangedMappings[0].OldValue)
	assert.Equal(t, "app", snap.ChangedMappings[0].OldValue.TargetLabel)
	assert.Nil(t, snap.ChangedMappings[0].NewValue)

	// 映射列表已空（空切片而非 null）。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, tmpl.ID).Error)
	assert.Empty(t, got.Mappings)
}

func TestDeleteLabelMappingNotFound(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)

	// 模板不存在 → not_found。
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, "/api/v2/platform/label-templates/99999/mappings/1", ""))
	assert.Equal(t, http.StatusNotFound, code)

	// mapping_id 越界 → not_found。
	tmpl := seedMappingTemplate(t, db)
	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/5", tmpl.ID)
	code, e = decodeErr(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, response.ErrorTypeNotFound, e.ErrorType)
}

func TestDeleteLabelMappingDefaultTemplateForbidden(t *testing.T) {
	db := openCRUDTestDB(t)
	r := mountMappings(t, db)
	def := seedDefaultMappingTemplate(t, db)

	path := fmt.Sprintf("/api/v2/platform/label-templates/%d/mappings/1", def.ID)
	code, e := decodeErr(t, doJSON(t, r, http.MethodDelete, path, ""))
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Contains(t, e.Error, "默认模板")

	// 默认模板 mappings 未被改动。
	var got models.LabelTemplate
	require.NoError(t, db.First(&got, def.ID).Error)
	require.Len(t, got.Mappings, len(def.Mappings))
}

// ============================ validateMappings 增强 ============================

func TestValidateMappingsEnhanced(t *testing.T) {
	// 保护 label 拦截（composite→instance 例外，其余一律阻止）。
	err := validateMappings([]models.LabelMapping{{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "job"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "保护")

	// composite→instance 例外通过。
	require.NoError(t, validateMappings([]models.LabelMapping{{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance"}}))

	// composite 且 target_label 非 instance → 拒绝（锁定 instance）。
	err = validateMappings([]models.LabelMapping{{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "foo"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "instance")

	// 同模板 target_label 重复 → 拒绝。
	err = validateMappings([]models.LabelMapping{
		{SourceField: "app_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app"},
		{SourceField: "service_name", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "app"},
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "重复")

	// 非法 source_type → 拒绝。
	err = validateMappings([]models.LabelMapping{{SourceField: "env", SourceType: models.LabelSourceType("unknown"), TargetLabel: "env"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "source_type")

	// 非法 transform → 拒绝。
	err = validateMappings([]models.LabelMapping{{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Transform: "lowerx"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "transform")

	// source_field 为空 → 拒绝。
	err = validateMappings([]models.LabelMapping{{SourceField: "", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env"}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "source_field")

	// 合法映射（含前缀 transform）→ 通过。
	require.NoError(t, validateMappings([]models.LabelMapping{
		{SourceField: "env", SourceType: models.LabelSourceTypeResourceField, TargetLabel: "env", Transform: "lower"},
		{SourceField: "instance_ip:port", SourceType: models.LabelSourceTypeComposite, TargetLabel: "instance"},
	}))
}
