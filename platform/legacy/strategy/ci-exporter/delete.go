package ciexporter

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteCITypeExporterMapping 是 DELETE /api/v2/platform/ci-exporter-mappings/:id
// 的 handler：软删默认采集配置。内置（is_builtin）禁删（bad_request）；被
// ScrapeJob 引用返回 forbidden（api-contract-snapshot §4）。成功返回 `{id}`。
func DeleteCITypeExporterMapping(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseMappingID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}

		var m models.CITypeExporterMapping
		if err := db.First(&m, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("ci-exporter mapping %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get ci-exporter mapping %d: %w", id, err))
			return
		}
		if m.IsBuiltin {
			response.BadRequest(c, fmt.Errorf("内置默认采集配置禁止删除（由平台 seed 维护）"))
			return
		}
		// 被 ScrapeJob 引用（同 monitor_type + exporter_template_id）禁删。
		if mappingReferenced(db, m) {
			response.Forbidden(c, fmt.Sprintf("默认采集配置（%s / exporter=%s）已被采集 Job 引用，禁止删除", m.MonitorType, m.ExporterTemplateID))
			return
		}

		if err := db.Delete(&m).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("delete ci-exporter mapping %d: %w", id, err))
			return
		}
		response.OK(c, gin.H{"id": id})
	}
}