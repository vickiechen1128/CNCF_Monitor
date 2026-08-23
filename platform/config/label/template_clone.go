// 本文件提供 LabelTemplate 克隆接口
// （POST /api/v2/platform/label-templates/:template_id/clone），见 Module_07
// §6.3 / §6.6.3（克隆含全部 mappings、is_default=false）。
package label

import (
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CloneLabelTemplateRequest 是克隆模板的请求体；name 可选，缺省时自动派生新名称
// （源名称 + " 副本"），避免与源模板同名同类型冲突。
type CloneLabelTemplateRequest struct {
	Name *string `json:"name"`
}

// CloneLabelTemplate 是 POST /:template_id/clone 的 handler：复制源模板及其全部
// mappings 到新模板（is_default=false），`{name?}` 可选覆盖名称；克隆成功返回
// 新模板；未命中 not_found。新模板的每次「创建」同样落一条快照。
func CloneLabelTemplate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}

		var src models.LabelTemplate
		if err := db.First(&src, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("label template %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get label template %d: %w", id, err))
			return
		}

		var req CloneLabelTemplateRequest
		// 克隆请求体可为空；仅显式提供 body 时解析，空 body（EOF）视为缺省名称。
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			response.BadRequest(c, fmt.Errorf("invalid clone payload: %w", err))
			return
		}

		name := fmt.Sprintf("%s 副本", src.Name)
		if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
			name = *req.Name
		}

		dup, err := templateExistsByNameCategory(db, name, src.ResourceCategory)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("check duplicate label template: %w", err))
			return
		}
		if dup {
			response.Conflict(c, fmt.Errorf("标签模板 %q（%s）已存在", name, src.ResourceCategory))
			return
		}

		clone := &models.LabelTemplate{
			Name:             name,
			ResourceCategory: src.ResourceCategory,
			IsDefault:        false, // 克隆模板恒非默认（PRD §6.3 / §6.6.3）
			Mappings:         append([]models.LabelMapping(nil), src.Mappings...),
		}
		// 克隆创建与快照写入置于同一事务（dev-feedback L-1）。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(clone).Error; err != nil {
				return fmt.Errorf("clone label template %d: %w", id, err)
			}
			if err := appendTemplateSnapshot(tx, clone.ID, newMappingChanges(clone.Mappings)); err != nil {
				return fmt.Errorf("append label template snapshot: %w", err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, clone)
	}
}
