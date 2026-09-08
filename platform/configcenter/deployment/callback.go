package deployment

import (
	"errors"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// writebackChangeStatus 在 ConfigDeployment.status=success（local reload 成功后）
// 回写 M01 ScrapeJob.change_status：pending → deployed（决策 31-M2 / PRD §3.5 / §5.6）。
// 仅更新已确认待下发（change_status=pending）且已就绪（draft_status=ready）的采集 Job；
// 与其状态不变的 Job（draft 态待下发 / none/confirmed/deployed）不扰动。
func writebackChangeStatus(db *gorm.DB, domainID string) error {
	res := db.Model(&models.ScrapeJob{}).
		Where("network_domain_id = ? AND change_status = ? AND draft_status = ?", domainID, models.ChangeStatusPending, "ready").
		Update("change_status", models.ChangeStatusDeployed)
	if res.Error != nil {
		return fmt.Errorf("writeback scrape job change_status: %w", res.Error)
	}
	return nil
}

// writebackRuleChangeStatus 在 ConfigDeployment.status=success（local reload 成功后）
// 回写 M01 MonitoringRule.change_status：pending → deployed（#18 补缺，对齐决策 31-M2）。
// 规则为全局 scope=central、无网域列，按「有变更被下发」全量回写；
// 仅更新已确认待下发（change_status=pending）且已就绪（draft_status=ready）的规则。
func writebackRuleChangeStatus(db *gorm.DB) error {
	res := db.Model(&models.MonitoringRule{}).
		Where("change_status = ? AND draft_status = ?", models.ChangeStatusPending, "ready").
		Update("change_status", models.ChangeStatusDeployed)
	if res.Error != nil {
		return fmt.Errorf("writeback rule change_status: %w", res.Error)
	}
	return nil
}

// writebackChangeStatuses 汇总回写 M01 源数据 change_status（采集 Job + 规则）。
// 任一失败均返回合并错误，由调用方降级记录到 error_message（投递成功与回写解耦）。
func writebackChangeStatuses(db *gorm.DB, domainID string) error {
	var errs []error
	if err := writebackChangeStatus(db, domainID); err != nil {
		errs = append(errs, err)
	}
	if err := writebackRuleChangeStatus(db); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// writebackAlertmanagerApplied 在 ConfigDeployment.status=success（管理域 default 含
// alertmanager.yml 下发 + AM reload 成功）后回写 M08（决策 60 / 决策 59）：
// 将最新一条 applied 的 AlertmanagerConfigVersion 标记已随 M09 下发
// （applied_at / source_change_no 回填）。M08 页面「当前生效配置只读视图」源自在途
// 最新 applied 版本。无 AM 产物或无非 applied 留痕时为空操作。
func writebackAlertmanagerApplied(db *gorm.DB, version *models.ConfigVersion, at time.Time) error {
	if version.AlertmanagerYml == "" {
		return nil
	}
	var cfg models.AlertmanagerConfigVersion
	if err := db.Where("status = ?", models.AlertmanagerConfigStatusApplied).
		Order("created_at DESC, id DESC").First(&cfg).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil // 无非 applied 留痕，无内容可回写
		}
		return fmt.Errorf("load latest alertmanager config version: %w", err)
	}
	cfg.AppliedAt = &at
	cfg.SourceChangeNo = version.ChangeNo
	// review-fix D：applied_at/source_change_no 用单条批量列更新（Updates(map)），
	// 原子且少一次往返，消除链式 Update().Update() 两条非原子 SQL 的并发打断窗口。
	if err := db.Model(&cfg).Updates(map[string]interface{}{
		"applied_at":      cfg.AppliedAt,
		"source_change_no": cfg.SourceChangeNo,
	}).Error; err != nil {
		return fmt.Errorf("writeback alertmanager applied: %w", err)
	}
	return nil
}