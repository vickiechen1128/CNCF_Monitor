package exportertemplate

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteExporterTemplate 是 DELETE /api/v2/platform/exporter-templates/:id 的
// handler：软删采集器模板。内置（is_builtin）只读禁删返回 forbidden；被
// CITypeExporterMapping 引用时返回 forbidden（api-contract-snapshot §3）。
// 成功返回 `{id}`。
func DeleteExporterTemplate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}

		var tmpl models.ExporterTemplate
		if err := db.First(&tmpl, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("exporter template %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get exporter template %d: %w", id, err))
			return
		}
		if tmpl.IsBuiltin {
			response.Forbidden(c, fmt.Sprintf("内置采集器模板 %q 只读，禁止删除", tmpl.Name))
			return
		}

		// 被 CITypeExporterMapping 引用（ExporterTemplateID 存的是 ID 字符串）时禁删。
		ref, err := exporterTemplateReferenced(db, tmpl.ID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if ref {
			response.Forbidden(c, fmt.Sprintf("采集器模板 %q 已被默认采集配置引用，禁止删除", tmpl.Name))
			return
		}

		if err := db.Delete(&tmpl).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("delete exporter template %d: %w", id, err))
			return
		}
		response.OK(c, gin.H{"id": id})
	}
}

// exporterTemplateReferenced 报告采集器模板 id 是否被任一活跃
// （未软删）CITypeExporterMapping 引用。
func exporterTemplateReferenced(db *gorm.DB, id uint) (bool, error) {
	var count int64
	if err := db.Model(&models.CITypeExporterMapping{}).
		Where("exporter_template_id = ?", strconv.FormatUint(uint64(id), 10)).
		Count(&count).Error; err != nil {
		return false, fmt.Errorf("count mapping references: %w", err)
	}
	return count > 0, nil
}