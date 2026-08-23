// label_write.go 提供资源标签写接口（POST/PUT/DELETE
// /api/v2/platform/resources/:resource_id/labels[/:label_id]，T07-12）：
//
//   - POST 添加 user 标签：仅 resource_category=application 资源可写（双场景治理，
//     §3.3/§6.2），静态资源返回 403；key 校验（ValidateLabelKey）、禁止覆盖
//     Prometheus 内置 label 与 system 保护标签（§8.2），重复 key 返回 conflict；
//   - PUT 编辑值 / DELETE 删除：仅 source=user 标签可操作（§6.6.2），非 user 来源
//     forbidden；写接口边界（仅 application）同样覆盖 PUT/DELETE（§6.2）；
//   - 资源/标签未命中返回 not_found。
//
// system 标签按资源类型默认模板实时计算、不落库（§5.3），写端复用 T07-11 的
// computeSystemLabels 做「user 不可覆盖 system」拦截（§8.2）。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
package resource

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// labelWriteRequest 是 POST 添加 user 标签的请求体（§6.6.2：{key, value}）。
type labelWriteRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// labelValueRequest 是 PUT 编辑标签值的请求体（§6.6.2：{value}）。
type labelValueRequest struct {
	Value string `json:"value"`
}

// staticResourceForbiddenMsg 是静态资源写 user 标签的 403 文案（§11.1 页面状态矩阵）。
const staticResourceForbiddenMsg = "该资源为静态资源，标签由 CMDB/Excel 带入，不支持手动打标"

// CreateResourceLabel 是 POST /api/v2/platform/resources/:resource_id/labels 的
// 添加 handler（§6.6.2）。
//
// 流程：
//  1. 按 resource_id 定位资源（复用 T07-06 findResourceByID）；不存在/已软删
//     → not_found；
//  2. 仅 application 可写 user 标签：host/database/middleware/generic_target
//     返回 403（静态资源只读，标签由 CMDB/Excel 带入，§3.3/§6.2/§11.1）；
//  3. key 校验：ValidateLabelKey（小写/下划线/禁 __ 开头/≤128）；
//  4. key ∈ PROTECTED_PROMETHEUS_LABELS 拒绝（禁止覆盖内置 label，§5.3）；
//  5. key ∈ 该资源 system 标签拒绝（user 不可覆盖 system，§8.2）；
//  6. 同资源已存在同 key 的 user 标签 → conflict（§6.6.2 重复 key）；
//  7. 落库 source=user，返回新增标签。
func CreateResourceLabel(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}

		var in labelWriteRequest
		if err := c.ShouldBindJSON(&in); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体必须是 {key, value} JSON：%w", err))
			return
		}
		key := strings.TrimSpace(in.Key)

		category, model, found, err := findResourceByID(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}
		if category != models.ResourceCategoryApplication {
			response.Forbidden(c, staticResourceForbiddenMsg)
			return
		}

		if err := models.ValidateLabelKey(key); err != nil {
			response.BadRequest(c, err)
			return
		}
		if models.IsProtectedLabel(key) {
			response.BadRequest(c, fmt.Errorf("label key %q 为 Prometheus 内置标签，禁止覆盖（instance/job/scheme/__address__ 等）", key))
			return
		}
		if labelKeyIsSystem(db, category, model, key) {
			response.BadRequest(c, fmt.Errorf("label key %q 为系统保护标签，由标签模板生成，不可覆盖（如需修改请前往标签模板管理）", key))
			return
		}

		var existing models.ResourceLabel
		err = db.Where("resource_id = ? AND key = ? AND source = ?", resourceID, key, models.LabelSourceUser).First(&existing).Error
		if err == nil {
			response.Conflict(c, fmt.Errorf("label key %q 已存在，请使用不同的 key", key))
			return
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			response.InternalServerError(c, fmt.Errorf("查询资源 %s 标签 %q 失败：%w", resourceID, key, err))
			return
		}

		label := &models.ResourceLabel{
			ResourceID: resourceID,
			Key:        key,
			Value:      in.Value,
			Source:     models.LabelSourceUser,
		}
		if err := db.Create(label).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("添加资源 %s 标签 %q 失败：%w", resourceID, key, err))
			return
		}
		response.OK(c, labelItem{
			ID:     label.ID,
			Key:    label.Key,
			Value:  label.Value,
			Source: string(label.Source),
		})
	}
}

// UpdateResourceLabel 是 PUT /api/v2/platform/resources/:resource_id/labels/:label_id
// 的编辑 handler（§6.6.2）：仅 source=user 标签可编辑，value 更新。
//
// 流程：
//  1. 按 resource_id 定位资源（不存在 → not_found），静态资源 → 403（写接口边界
//     同样覆盖 PUT，§6.2）；
//  2. 按 label_id 定位该资源下的库内标签（不存在/已软删 → not_found）；
//  3. 仅 source=user 可编辑：非 user 来源（system 不落库、cmdb 为 v0.4+ 预留）
//     → forbidden（§6.6.2）；
//  4. 更新 value，返回更新后的标签。
func UpdateResourceLabel(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}
		labelIDRaw := strings.TrimSpace(c.Param("label_id"))
		labelID, err := parseLabelID(labelIDRaw)
		if err != nil {
			response.BadRequest(c, err)
			return
		}

		var in labelValueRequest
		if err := c.ShouldBindJSON(&in); err != nil {
			response.BadRequest(c, fmt.Errorf("请求体必须是 {value} JSON：%w", err))
			return
		}

		category, _, found, err := findResourceByID(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}
		if category != models.ResourceCategoryApplication {
			response.Forbidden(c, staticResourceForbiddenMsg)
			return
		}

		label, err := findLabelByID(db, resourceID, labelID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if label == nil {
			response.NotFound(c, fmt.Sprintf("标签 %s 不存在或已删除", labelIDRaw))
			return
		}
		if label.Source != models.LabelSourceUser {
			response.Forbidden(c, fmt.Sprintf("标签 %q 来源为 %s，仅 user 来源标签可编辑", label.Key, label.Source))
			return
		}

		if err := db.Model(label).Update("value", in.Value).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("更新标签 %s 失败：%w", labelIDRaw, err))
			return
		}
		response.OK(c, labelItem{
			ID:     label.ID,
			Key:    label.Key,
			Value:  in.Value,
			Source: string(label.Source),
		})
	}
}

// DeleteResourceLabel 是 DELETE /api/v2/platform/resources/:resource_id/labels/:label_id
// 的删除 handler（§6.6.2）：仅 source=user 标签可删除，成功返回 {label_id}。
//
// 流程：
//  1. 按 resource_id 定位资源（不存在 → not_found），静态资源 → 403（§6.2）；
//  2. 按 label_id 定位该资源下的库内标签（不存在 → not_found）；
//  3. 仅 source=user 可删除：非 user 来源 → forbidden（§6.6.2）；
//  4. 软删（BaseModel.DeletedAt 置位），返回 {label_id}。
func DeleteResourceLabel(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}
		labelIDRaw := strings.TrimSpace(c.Param("label_id"))
		labelID, err := parseLabelID(labelIDRaw)
		if err != nil {
			response.BadRequest(c, err)
			return
		}

		category, _, found, err := findResourceByID(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}
		if category != models.ResourceCategoryApplication {
			response.Forbidden(c, staticResourceForbiddenMsg)
			return
		}

		label, err := findLabelByID(db, resourceID, labelID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if label == nil {
			response.NotFound(c, fmt.Sprintf("标签 %s 不存在或已删除", labelIDRaw))
			return
		}
		if label.Source != models.LabelSourceUser {
			response.Forbidden(c, fmt.Sprintf("标签 %q 来源为 %s，仅 user 来源标签可删除", label.Key, label.Source))
			return
		}

		if err := db.Delete(label).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("删除标签 %s 失败：%w", labelIDRaw, err))
			return
		}
		response.OK(c, gin.H{"label_id": labelIDRaw})
	}
}

// parseLabelID 解析路径中的 label_id（ResourceLabel 主键，无符号整型）。
func parseLabelID(raw string) (uint, error) {
	if raw == "" {
		return 0, fmt.Errorf("label_id 必填")
	}
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		return 0, fmt.Errorf("label_id 必须为数字")
	}
	return uint(id), nil
}

// findLabelByID 按主键 + 资源定位库内标签（GORM 自动排除软删）；未命中返回
// (nil, nil)，DB 错误返回包装后的错误。
func findLabelByID(db *gorm.DB, resourceID string, labelID uint) (*models.ResourceLabel, error) {
	var label models.ResourceLabel
	err := db.Where("id = ? AND resource_id = ?", labelID, resourceID).First(&label).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("查询标签 %d 失败：%w", labelID, err)
	}
	return &label, nil
}

// labelKeyIsSystem 报告 key 是否为该资源的 system 标签（按资源类型默认模板实时
// 计算、不落库，复用 T07-11 computeSystemLabels）。无默认模板时 system 为空，
// 返回 false（不因模板缺失阻断 user 标签写入）。
func labelKeyIsSystem(db *gorm.DB, category models.ResourceCategory, model any, key string) bool {
	res, ok := model.(models.Resource)
	if !ok {
		return false
	}
	for _, it := range computeSystemLabels(db, category, res) {
		if it.Key == key {
			return true
		}
	}
	return false
}
