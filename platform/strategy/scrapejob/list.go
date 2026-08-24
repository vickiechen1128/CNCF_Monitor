// Package scrapejob implements Module_01 ScrapeJob（采集 Job）API：列表、CRUD、
// 网域已纳管/冻结校验、认证TLS与 blackbox 校验、参数快照继承，以及实例候选 /
// 安装确认 / preview-targets（见 selection.go / installation.go / preview.go）。
// 本文件提供列表接口 GET /api/v2/platform/scrape-jobs。
package scrapejob

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/common"
	"gorm.io/gorm"
)

// ListScrapeJobs 返回分页、可筛选的采集 Job 列表。
//
// Query: network_domain_id(仅已纳管)/ monitor_type / job_type / enabled /
// keyword / page / page_size（默认 20，上限 100）。响应 data：`{list, total,
// page, page_size}`，item 含 change_status。软删 Job 不进入列表，空结果返回空 list。
func ListScrapeJobs(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := common.ParsePageParams(c.Request.URL.Query())

		// label_template_id 反查模式（api-contract-snapshot §2）：返回引用该模板的 Job。
		if c.Query("label_template_id") != "" {
			listJobsByLabelTemplate(c, db, c.Query("label_template_id"))
			return
		}

		q := db.Model(&models.ScrapeJob{})
		if d := c.Query("network_domain_id"); d != "" {
			q = q.Where("network_domain_id = ?", d)
		}
		if mt := c.Query("monitor_type"); mt != "" {
			q = q.Where("monitor_type = ?", mt)
		}
		if jt := c.Query("job_type"); jt != "" {
			q = q.Where("job_type = ?", jt)
		}
		if raw := c.Query("enabled"); raw != "" && (raw == "true" || raw == "1") {
			q = q.Where("enabled = ?", true)
		} else if raw == "false" || raw == "0" {
			q = q.Where("enabled = ?", false)
		}
		if kw := c.Query("keyword"); kw != "" {
			q = q.Where("job_name LIKE ?", "%"+kw+"%")
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count scrape jobs: %w", err))
			return
		}

		var jobs []models.ScrapeJob
		if err := q.Order("created_at desc").
			Offset((p.Page - 1) * p.PageSize).
			Limit(p.PageSize).
			Find(&jobs).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list scrape jobs: %w", err))
			return
		}

		list := make([]models.ScrapeJob, 0, len(jobs))
		list = append(list, jobs...)
		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}

// listJobsByLabelTemplate 返回引用指定标签模板的 Job 列表（label_template_id 必填
// 反查）。模板不存在返回 not_found（api-contract-snapshot §5）。
func listJobsByLabelTemplate(c *gin.Context, db *gorm.DB, labelTemplateID string) {
	var lt models.LabelTemplate
	if err := db.First(&lt, "id = ?", labelTemplateID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			response.NotFound(c, fmt.Sprintf("label template %s not found", labelTemplateID))
			return
		}
		response.InternalServerError(c, fmt.Errorf("get label template %s: %w", labelTemplateID, err))
		return
	}

	var jobs []models.ScrapeJob
	if err := db.Where("label_template_id = ?", labelTemplateID).
		Order("created_at desc").Find(&jobs).Error; err != nil {
		response.InternalServerError(c, fmt.Errorf("list scrape jobs by label template: %w", err))
		return
	}
	list := make([]models.ScrapeJob, 0, len(jobs))
	list = append(list, jobs...)
	response.OK(c, gin.H{"list": list, "total": int64(len(jobs))})
}