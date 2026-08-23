// 本文件提供 LabelTemplate mappings CRUD 接口
// （POST/PUT/DELETE /api/v2/platform/label-templates/:template_id/mappings[/:mapping_id]），
// 见 Module_07 §5.11 / §6.3 / §6.6.3。mappings 以内嵌 JSON 数组存于模板
// （serializer:json，无独立主键），mapping_id 采用 1-based 数组位置。
package label

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// mappingTargetInstance 是 composite 组合字段固定的目标标签（§5.11 / §5.12 C）。
const mappingTargetInstance = "instance"

// CreateMappingRequest 是新增映射的请求体（PRD §6.6.3）：
// {target_label, source_type, source_field, transform_rule?}；target_label 可选，
// resource_field 缺省时默认预填为 source_field、composite 锁定为 instance；
// enabled 可选，缺省为 true。
type CreateMappingRequest struct {
	TargetLabel   string                `json:"target_label"`
	SourceType    models.LabelSourceType `json:"source_type"`
	SourceField   string                `json:"source_field"`
	TransformRule *string               `json:"transform_rule"`
	Enabled       *bool                 `json:"enabled"`
}

// UpdateMappingRequest 是编辑映射的请求体（PRD §6.6.3）：全部字段可选（部分
// 更新）；transform_rule 显式传空字符串即清空为原样，缺省（null）表示不修改。
type UpdateMappingRequest struct {
	TargetLabel   *string                `json:"target_label"`
	SourceType    *models.LabelSourceType `json:"source_type"`
	SourceField   *string                `json:"source_field"`
	TransformRule *string                `json:"transform_rule"`
	Enabled       *bool                  `json:"enabled"`
}

// validSourceType 报告 source_type 是否为合法枚举（§5.11：resource_field /
// prometheus_builtin / composite / cmdb_field{v0.4+}）。
func validSourceType(st models.LabelSourceType) bool {
	switch st {
	case models.LabelSourceTypeResourceField,
		models.LabelSourceTypeComposite,
		models.LabelSourceTypePrometheusBuiltin,
		models.LabelSourceTypeCMDB:
		return true
	}
	return false
}

// validTransformRules 是 transform 枚举（§5.11）：空=原样透传；lower/upper/
// prefix/replace 为 P1 MVP 置灰但枚举接受。
var validTransformRules = map[string]struct{}{
	"":        {},
	"lower":   {},
	"upper":   {},
	"prefix":  {},
	"replace": {},
}

// validateTransformRule 校验 transform_rule 枚举（§5.11）。
func validateTransformRule(rule string) error {
	if _, ok := validTransformRules[rule]; !ok {
		return fmt.Errorf("transform_rule %q 非法，可选：lower/upper/prefix/replace 或空", rule)
	}
	return nil
}

// validateTargetLabel 校验 target_label：格式合法（ValidateLabelKey，§5.3）且
// 不在保护 label 集合中——composite→instance 例外（§5.11 / §9.2 P1）。
func validateTargetLabel(st models.LabelSourceType, targetLabel string) error {
	if err := models.ValidateLabelKey(targetLabel); err != nil {
		return err
	}
	if models.IsProtectedLabel(targetLabel) {
		if st == models.LabelSourceTypeComposite && targetLabel == mappingTargetInstance {
			return nil // composite→instance 例外
		}
		return fmt.Errorf("目标标签 %q 是受保护的 Prometheus 标签，禁止覆盖", targetLabel)
	}
	return nil
}

// resolveCreateTargetLabel 决定新增映射的 target_label（§5.11 目标标签默认值）：
//   - composite：锁定为 instance（组合字段是预置规则，标签名不可由用户改动）；
//   - resource_field：缺省时默认预填为 source_field；
//   - 其他来源：必须显式提供非空 target_label。
func resolveCreateTargetLabel(st models.LabelSourceType, sourceField, targetLabel string) (string, error) {
	switch st {
	case models.LabelSourceTypeComposite:
		return mappingTargetInstance, nil
	case models.LabelSourceTypeResourceField:
		if strings.TrimSpace(targetLabel) == "" {
			return sourceField, nil
		}
		return strings.TrimSpace(targetLabel), nil
	default:
		if strings.TrimSpace(targetLabel) == "" {
			return "", fmt.Errorf("target_label 不能为空")
		}
		return strings.TrimSpace(targetLabel), nil
	}
}

// parseMappingID 解析路径参数 mapping_id 为 1-based 数组位置（正整数）；
// 非法/缺省/为 0 返回 false。
func parseMappingID(c *gin.Context) (int, bool) {
	raw := c.Param("mapping_id")
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		return 0, false
	}
	return int(id), true
}

// loadTemplate 按 id 加载活跃模板；返回 (模板, 是否命中)。未命中时已写 not_found 响应。
func loadTemplate(c *gin.Context, db *gorm.DB, id uint) (*models.LabelTemplate, bool) {
	var tmpl models.LabelTemplate
	if err := db.First(&tmpl, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			response.NotFound(c, fmt.Sprintf("label template %d not found", id))
			return nil, false
		}
		response.InternalServerError(c, fmt.Errorf("get label template %d: %w", id, err))
		return nil, false
	}
	return &tmpl, true
}

// rejectDefaultTemplate 对默认模板的映射变更返回 bad_request（默认模板只读保护，
// 改动走克隆，§6.6.3）。返回 true 表示已拒绝。
func rejectDefaultTemplate(c *gin.Context, tmpl *models.LabelTemplate) bool {
	if tmpl.IsDefault {
		response.BadRequest(c, fmt.Errorf("默认模板只读保护，映射变更请基于默认模板克隆后操作"))
		return true
	}
	return false
}

// CreateLabelMapping 是 POST /:template_id/mappings 的 handler：新增一条映射并
// 落快照（OldValue 空、NewValue 为新增映射）。校验：保护 label 拦截（composite→
// instance 例外）、source_type/source_field/transform 枚举、同模板 target_label
// 唯一。成功返回更新后的 mappings 列表。默认模板只读（拒绝）。
func CreateLabelMapping(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}
		tmpl, ok := loadTemplate(c, db, id)
		if !ok {
			return
		}
		if rejectDefaultTemplate(c, tmpl) {
			return
		}

		var req CreateMappingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid mapping payload: %w", err))
			return
		}
		if !validSourceType(req.SourceType) {
			response.BadRequest(c, fmt.Errorf("source_type %q 非法，可选：resource_field/composite/prometheus_builtin/cmdb_field", req.SourceType))
			return
		}
		sourceField := strings.TrimSpace(req.SourceField)
		if sourceField == "" {
			response.BadRequest(c, fmt.Errorf("source_field 不能为空"))
			return
		}
		targetLabel, err := resolveCreateTargetLabel(req.SourceType, sourceField, req.TargetLabel)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		if err := validateTargetLabel(req.SourceType, targetLabel); err != nil {
			response.BadRequest(c, err)
			return
		}
		transform := ""
		if req.TransformRule != nil {
			transform = strings.TrimSpace(*req.TransformRule)
		}
		if err := validateTransformRule(transform); err != nil {
			response.BadRequest(c, err)
			return
		}

		// 同模板 target_label 唯一（§5.11）。
		for _, m := range tmpl.Mappings {
			if m.TargetLabel == targetLabel {
				response.BadRequest(c, fmt.Errorf("目标标签 %q 在该模板内已存在，target_label 重复、必须唯一", targetLabel))
				return
			}
		}

		m := models.LabelMapping{
			SourceField: sourceField,
			SourceType:  req.SourceType,
			TargetLabel: targetLabel,
			Enabled:     true, // 新增映射默认启用
			Transform:   transform,
		}
		if req.Enabled != nil {
			m.Enabled = *req.Enabled
		}
		tmpl.Mappings = append(tmpl.Mappings, m)

		// serializer:json 字段须走 Save 整体序列化（db.Update 单列不识别 serializer）。
		// 映射写入与快照置于同一事务（dev-feedback L-1）。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(tmpl).Error; err != nil {
				return fmt.Errorf("append mapping to label template %d: %w", id, err)
			}
			if err := appendTemplateSnapshot(tx, tmpl.ID, newMappingChanges([]models.LabelMapping{m})); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, tmpl.Mappings)
	}
}

// UpdateLabelMapping 是 PUT /:template_id/mappings/:mapping_id 的 handler：部分
// 更新映射并落快照（OldValue/NewValue 双记录）。唯一性校验排除编辑自身；
// composite 目标标签锁定为 instance；transform_rule 显式空串即清空。成功返回
// 更新后的 mappings 列表。默认模板只读（拒绝）。
func UpdateLabelMapping(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}
		idx, ok := parseMappingID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("mapping_id 非法"))
			return
		}
		tmpl, ok := loadTemplate(c, db, id)
		if !ok {
			return
		}
		if rejectDefaultTemplate(c, tmpl) {
			return
		}
		if idx > len(tmpl.Mappings) {
			response.NotFound(c, fmt.Sprintf("mapping %d not found in label template %d", idx, id))
			return
		}

		var req UpdateMappingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid mapping payload: %w", err))
			return
		}

		old := tmpl.Mappings[idx-1]
		newMapping := old

		// source_type：可更新，需合法枚举。
		if req.SourceType != nil {
			if !validSourceType(*req.SourceType) {
				response.BadRequest(c, fmt.Errorf("source_type %q 非法，可选：resource_field/composite/prometheus_builtin/cmdb_field", *req.SourceType))
				return
			}
			newMapping.SourceType = *req.SourceType
		}
		// source_field：可更新，非空。
		if req.SourceField != nil {
			sf := strings.TrimSpace(*req.SourceField)
			if sf == "" {
				response.BadRequest(c, fmt.Errorf("source_field 不能为空"))
				return
			}
			newMapping.SourceField = sf
		}
		// target_label：composite 锁定为 instance；resource_field 显式空串时预填
		// source_field（§5.11）；缺省保留原值。
		if newMapping.SourceType == models.LabelSourceTypeComposite {
			newMapping.TargetLabel = mappingTargetInstance
		} else if req.TargetLabel != nil {
			t := strings.TrimSpace(*req.TargetLabel)
			if t == "" {
				if newMapping.SourceType == models.LabelSourceTypeResourceField {
					t = newMapping.SourceField
				} else {
					response.BadRequest(c, fmt.Errorf("target_label 不能为空"))
					return
				}
			}
			newMapping.TargetLabel = t
		}
		if err := validateTargetLabel(newMapping.SourceType, newMapping.TargetLabel); err != nil {
			response.BadRequest(c, err)
			return
		}
		// transform_rule：缺省保留原值；显式传入（含空串）则更新并校验枚举。
		if req.TransformRule != nil {
			newMapping.Transform = strings.TrimSpace(*req.TransformRule)
			if err := validateTransformRule(newMapping.Transform); err != nil {
				response.BadRequest(c, err)
				return
			}
		}
		if req.Enabled != nil {
			newMapping.Enabled = *req.Enabled
		}

		// 同模板 target_label 唯一，排除编辑自身（§6.6.3）。
		for i, m := range tmpl.Mappings {
			if i == idx-1 {
				continue
			}
			if m.TargetLabel == newMapping.TargetLabel {
				response.BadRequest(c, fmt.Errorf("目标标签 %q 在该模板内已存在，target_label 重复、必须唯一", newMapping.TargetLabel))
				return
			}
		}

		tmpl.Mappings[idx-1] = newMapping
		// serializer:json 字段须走 Save 整体序列化。
		// 映射更新与快照置于同一事务（dev-feedback L-1）。
		changes := []models.MappingChange{{
			TargetLabel: newMapping.TargetLabel,
			OldValue:    &old,
			NewValue:    &newMapping,
		}}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(tmpl).Error; err != nil {
				return fmt.Errorf("update mapping %d of label template %d: %w", idx, id, err)
			}
			if err := appendTemplateSnapshot(tx, tmpl.ID, changes); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, tmpl.Mappings)
	}
}

// DeleteLabelMapping 是 DELETE /:template_id/mappings/:mapping_id 的 handler：
// 删除映射并落快照（OldValue 为被移除映射、NewValue 空）。未命中 not_found；
// 默认模板映射不可删除（默认模板只读保护，改走克隆）。成功返回 `{mapping_id}`。
func DeleteLabelMapping(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}
		idx, ok := parseMappingID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("mapping_id 非法"))
			return
		}
		tmpl, ok := loadTemplate(c, db, id)
		if !ok {
			return
		}
		if rejectDefaultTemplate(c, tmpl) {
			return
		}
		if idx > len(tmpl.Mappings) {
			response.NotFound(c, fmt.Sprintf("mapping %d not found in label template %d", idx, id))
			return
		}

		removed := tmpl.Mappings[idx-1]
		tmpl.Mappings = append(tmpl.Mappings[:idx-1], tmpl.Mappings[idx:]...)
		if tmpl.Mappings == nil {
			tmpl.Mappings = []models.LabelMapping{} // 空列表序列化为 [] 而非 null
		}
		// serializer:json 字段须走 Save 整体序列化。
		// 映射删除与快照置于同一事务（dev-feedback L-1）。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Save(tmpl).Error; err != nil {
				return fmt.Errorf("delete mapping %d of label template %d: %w", idx, id, err)
			}
			if err := appendTemplateSnapshot(tx, tmpl.ID, removedMappingChanges([]models.LabelMapping{removed})); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"mapping_id": idx})
	}
}
