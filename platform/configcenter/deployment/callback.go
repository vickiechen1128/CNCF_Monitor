package deployment

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// writebackChangeStatus 在 ConfigDeployment.status=success（local reload 成功后）
// 回写 M01 ScrapeJob.change_status：pending → deployed（决策 31-M2 / PRD §3.5 / §5.6）。
// 仅更新已确认待下发（change_status=pending）且已就绪（draft_status=ready）的采集 Job；
// 与其状态不变的 Job（none/confirmed/deployed）不扰动。
func writebackChangeStatus(db *gorm.DB, domainID string) error {
	res := db.Model(&models.ScrapeJob{}).
		Where("network_domain_id = ? AND change_status = ?", domainID, models.ChangeStatusPending).
		Update("change_status", models.ChangeStatusDeployed)
	if res.Error != nil {
		return fmt.Errorf("writeback scrape job change_status: %w", res.Error)
	}
	return nil
}