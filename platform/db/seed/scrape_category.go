package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runScrapeJobCategoryBackfill 把标准采集 Job 的空 resource_type 按 monitor_type
// 推导回填。
//
// 背景：标准采集 Job 的创建链路早期只提交 monitor_type，resource_type 落空串。
// 生成配置时 LoadTemplateForJob 以 `resource_category = ""` 回落到默认模板，查不到
// 任何模板 → target 上整份模板标签集静默为空（app / biz / env / platform /
// resource_id 全缺），表现为「选了使用默认标签模板，但一个标签都没有」。
//
// 保存链路已由 scrapejob.validateJobRequest 统一推导（create / update / 批量提交
// 生效均覆盖），本函数只负责修正**存量**行。
//
// 幂等：仅命中 job_type=standard 且 resource_type 为空的行；未知 monitor_type
// 保持原样，不影响其他行。
func runScrapeJobCategoryBackfill(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("backfill scrape job resource_type: nil database connection")
	}
	var jobs []models.ScrapeJob
	if err := db.Where("job_type = ? AND (resource_type IS NULL OR resource_type = '')", models.JobTypeStandard).
		Find(&jobs).Error; err != nil {
		return fmt.Errorf("query scrape jobs with empty resource_type: %w", err)
	}
	for i := range jobs {
		d, ok := models.DeriveResourceFilter(jobs[i].MonitorType)
		if !ok {
			// 未知 / 空 monitor_type：保持原样，由保存链路或后续人工处理。
			continue
		}
		if err := db.Model(&models.ScrapeJob{}).
			Where("id = ?", jobs[i].ID).
			Update("resource_type", string(d.Category)).Error; err != nil {
			return fmt.Errorf("backfill scrape job %d resource_type: %w", jobs[i].ID, err)
		}
	}
	return nil
}
