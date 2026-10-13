package deployment

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// writebackChangeStatus 在下发投递成功（ConfigDeployment.status=success；回滚动作
// 为 rolled_back，PRD §8 视同 success，local reload 成功后）回写 M01
// ScrapeJob.change_status：pending → deployed（决策 31-M2 / PRD §3.5 / §5.6）。
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

// writebackRuleChangeStatus 在下发投递成功（status=success；回滚动作为 rolled_back，
// 视同 success，local reload 成功后）回写 M01 MonitoringRule.change_status：
// pending → deployed（#18 补缺，对齐决策 31-M2）。
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

// writebackAlertmanagerApplied 在下发投递成功（status=success；回滚动作为 rolled_back，
// 视同 success；管理域 default 含 alertmanager.yml 下发 + AM reload 成功）后回写 M08
// （决策 60 / 决策 59）：
// 将本单来源的 AlertmanagerConfigVersion 标记已随 M09 下发（applied_at / source_change_no
// 回填）。M08 页面「当前生效配置只读视图」源自在途最新 applied 版本。无 AM 产物或
// 无来源留痕时为空操作。
//
// 2026-10-13（dev-feedback #44）精确匹配修订：原实现取「最新一条 applied 留痕」无条件
// 回填，在「挂载新版本后确认旧单」场景会把**未随本单下发**的新版本错标为已生效
// （磁盘写的是旧单产物）。现按 ConfigDraft.AlertmanagerSourceVersionID（生成时与产物
// 内容同一次加载获得）精确回填来源版本；并把「创建时间不晚于来源版本之后、仍待确认」
// 的留痕一并标记已生效——它们的产物经物化与本单 checksum 相同（否则取代机制早已
// 生成新单，旧单不可再确认），内容同样随本单下发，不应永久停在「已提交，待确认下发」
// （reuse 路径遗留）。status=applied 条件避免 resurrect 已被废弃联标记的 discarded 留痕。
// 存量单（无来源记录）回落旧口径，但仅补**未生效**的最新留痕，不覆盖已生效版本时间戳。
func writebackAlertmanagerApplied(db *gorm.DB, version *models.ConfigVersion, at time.Time) error {
	if version.AlertmanagerYml == "" {
		return nil
	}
	sourceID := draftAlertmanagerSourceID(db, version)
	if sourceID > 0 {
		return writebackAlertmanagerSource(db, version, sourceID, at)
	}
	// 存量回落：最新一条**未生效**留痕（applied_at 为空）。
	var cfg models.AlertmanagerConfigVersion
	if err := db.Where("status = ?", models.AlertmanagerConfigStatusApplied).
		Where("applied_at IS NULL").
		Order("created_at DESC, id DESC").First(&cfg).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil // 无非 applied 留痕，无内容可回写
		}
		return fmt.Errorf("load latest alertmanager config version: %w", err)
	}
	return applyAlertmanagerWriteback(db, &cfg, version.ChangeNo, at)
}

// draftAlertmanagerSourceID 从本单草稿读取登记的 AM 来源留痕版本 ID；草稿缺失 /
// 解析失败 / 存量单无记录时返回 0（调用方回落旧口径）。
func draftAlertmanagerSourceID(db *gorm.DB, version *models.ConfigVersion) uint {
	if version.DraftID == "" {
		return 0
	}
	id, err := strconv.ParseUint(version.DraftID, 10, 64)
	if err != nil || id == 0 {
		return 0
	}
	var d models.ConfigDraft
	if err := db.Where("id = ?", id).First(&d).Error; err != nil {
		return 0 // 草稿缺失不阻断下发回写（降级为旧口径）
	}
	return d.AlertmanagerSourceVersionID
}

// writebackAlertmanagerSource 按来源版本 ID 精确回写：来源版本自身 + 创建时间不早于
// 它的其余待确认留痕（同产物 checksum 的兄弟版本，见 writebackAlertmanagerApplied 注释）。
func writebackAlertmanagerSource(db *gorm.DB, version *models.ConfigVersion, sourceID uint, at time.Time) error {
	var src models.AlertmanagerConfigVersion
	if err := db.First(&src, sourceID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil // 来源留痕已被删，无内容可回写
		}
		return fmt.Errorf("load source alertmanager config version: %w", err)
	}
	// 兄弟版本（reuse 路径遗留）：与来源同产物、随后挂载、仍待确认的一并标记已生效。
	// status=applied 条件：不 resurrect 已被废弃联标记的 discarded 留痕（竞态残留）。
	if err := db.Model(&models.AlertmanagerConfigVersion{}).
		Where("status = ? AND applied_at IS NULL AND created_at >= ?",
			models.AlertmanagerConfigStatusApplied, src.CreatedAt).
		Updates(map[string]interface{}{
			"status":           models.AlertmanagerConfigStatusApplied,
			"applied_at":       &at,
			"source_change_no": version.ChangeNo,
		}).Error; err != nil {
		return fmt.Errorf("writeback alertmanager applied siblings: %w", err)
	}
	// 来源版本自身：可能曾被废弃联标记为 discarded（其后单被确认即自愈），直接置回生效。
	return applyAlertmanagerWriteback(db, &src, version.ChangeNo, at)
}

// applyAlertmanagerWriteback 对单条留痕执行 applied_at / source_change_no 回填
// （status 归一为 applied：确认下发即生效信号）。
func applyAlertmanagerWriteback(db *gorm.DB, cfg *models.AlertmanagerConfigVersion, changeNo string, at time.Time) error {
	cfg.AppliedAt = &at
	cfg.SourceChangeNo = changeNo
	// review-fix D：applied_at/source_change_no 用单条批量列更新（Updates(map)），
	// 原子且少一次往返，消除链式 Update().Update() 两条非原子 SQL 的并发打断窗口。
	if err := db.Model(cfg).Updates(map[string]interface{}{
		"applied_at":       cfg.AppliedAt,
		"source_change_no": cfg.SourceChangeNo,
		"status":           models.AlertmanagerConfigStatusApplied,
	}).Error; err != nil {
		return fmt.Errorf("writeback alertmanager applied: %w", err)
	}
	return nil
}
