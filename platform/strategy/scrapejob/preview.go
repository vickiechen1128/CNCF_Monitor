package scrapejob

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// previewTarget 是 preview-targets 解析后的单个目标。
type previewTarget struct {
	ResourceID string `json:"resource_id,omitempty"`
	Address    string `json:"address"` // standard→实例地址；blackbox→target
	Protocol   string `json:"protocol,omitempty"`
}

// PreviewTargets 是 POST /api/v2/platform/scrape-jobs/:id/preview-targets 的
// handler：解析该 Job 的目标清单。standard→已选实例地址（host PrivateIP /
// database InstanceIP / middleware InstanceIP / application HealthCheckURL /
// generic_target InstanceIP）；blackbox→blackbox_targets（api-contract-snapshot §6,
// L2 接口预览）。Job 未命中 not_found。
func PreviewTargets(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var job models.ScrapeJob
		if err := db.First(&job, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("scrape job %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get scrape job %d: %w", id, err))
			return
		}

		if job.JobType == models.JobTypeBlackbox {
			items := make([]previewTarget, 0, len(job.BlackboxTargets))
			for _, t := range job.BlackboxTargets {
				items = append(items, previewTarget{Address: t.Target, Protocol: string(t.Protocol)})
			}
			response.OK(c, gin.H{"targets": items})
			return
		}

		items := make([]previewTarget, 0, len(job.SelectedInstanceIDs))
		for _, rid := range job.SelectedInstanceIDs {
			addr := resolveInstanceAddress(db, rid)
			items = append(items, previewTarget{ResourceID: rid, Address: addr})
		}
		response.OK(c, gin.H{"targets": items})
	}
}

// resolveInstanceAddress 根据 resource_id 在五类资源表中查找该实例地址；
// 未命中返回空字符串。
func resolveInstanceAddress(db *gorm.DB, resourceID string) string {
	var host models.Host
	if err := db.Where("resource_id = ?", resourceID).First(&host).Error; err == nil {
		return host.PrivateIP
	}
	var database models.Database
	if err := db.Where("resource_id = ?", resourceID).First(&database).Error; err == nil {
		return database.InstanceIP
	}
	var middleware models.Middleware
	if err := db.Where("resource_id = ?", resourceID).First(&middleware).Error; err == nil {
		return middleware.InstanceIP
	}
	var application models.Application
	if err := db.Where("resource_id = ?", resourceID).First(&application).Error; err == nil {
		return application.HealthCheckURL
	}
	var generic models.GenericTarget
	if err := db.Where("resource_id = ?", resourceID).First(&generic).Error; err == nil {
		return generic.InstanceIP
	}
	return ""
}