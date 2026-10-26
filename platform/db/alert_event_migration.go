// alert_event_migration.go 负责历史告警表的增量迁移：
//   - 把存量时间字段统一刷成 UTC+8（与新建记录口径一致）；
//   - 为存量终态行回填 closed_at（resolved 取 ends_at，其余取 updated_at）；
//   - 为存量有指纹记录回填 occurrence_key（指纹 + UTC 毫秒开始时间的哈希）。
//
// 迁移只处理 alert_events 一张表；其他业务表的时间字段不在本次范围内
// （2026-10-26 用户确认：历史其他表不动，新数据由各业务自行维护）。
// 幂等：已归一化 / 已回填的行不会重复更新。
package db

import (
	"fmt"
	"log"

	"github.com/metriccenter/metriccenter/platform/models"
)

// migrateAlertEvents 执行历史告警表的存量数据迁移。
func migrateAlertEvents() error {
	var rows []models.AlertEvent
	// MVP 阶段历史告警体量可控，一次性载入后逐行归一化；后续数据量上来后可改为分批。
	if err := DB.Unscoped().Find(&rows).Error; err != nil {
		return fmt.Errorf("load alert events for migration: %w", err)
	}
	for i := range rows {
		ev := &rows[i]
		if err := migrateOneAlertEvent(ev); err != nil {
			return err
		}
	}
	return nil
}

// migrateOneAlertEvent 归一化单行时间字段、回填 closed_at 与 occurrence_key。
func migrateOneAlertEvent(ev *models.AlertEvent) error {
	updates := map[string]interface{}{}

	if ev.StartsAt != nil {
		updates["starts_at"] = models.NormalizeAlertEventTime(*ev.StartsAt)
	}
	if ev.EndsAt != nil {
		updates["ends_at"] = models.NormalizeAlertEventTime(*ev.EndsAt)
	}
	if ev.ClosedAt != nil {
		updates["closed_at"] = models.NormalizeAlertEventTime(*ev.ClosedAt)
	}
	if ev.LastNotifiedAt != nil {
		updates["last_notified_at"] = models.NormalizeAlertEventTime(*ev.LastNotifiedAt)
	}
	if !ev.CreatedAt.IsZero() {
		updates["created_at"] = models.NormalizeAlertEventTime(ev.CreatedAt)
	}
	if !ev.UpdatedAt.IsZero() {
		updates["updated_at"] = models.NormalizeAlertEventTime(ev.UpdatedAt)
	}

	// 存量终态行补 closed_at：真实恢复取 ends_at；判定结束取 updated_at（当时内容的最后变化时刻）。
	if ev.ClosedAt == nil {
		switch ev.Status {
		case models.AlertEventStatusResolved:
			switch {
			case ev.EndsAt != nil:
				updates["closed_at"] = models.NormalizeAlertEventTime(*ev.EndsAt)
			case !ev.UpdatedAt.IsZero():
				updates["closed_at"] = models.NormalizeAlertEventTime(ev.UpdatedAt)
			}
		case models.AlertEventStatusSilencedClosed,
			models.AlertEventStatusInhibitedClosed,
			models.AlertEventStatusLost:
			if !ev.UpdatedAt.IsZero() {
				updates["closed_at"] = models.NormalizeAlertEventTime(ev.UpdatedAt)
			}
		}
	}

	// 有指纹但还没去重键的行补 occurrence_key；无指纹行保持空串（不参与唯一约束）。
	if ev.OccurrenceKey == "" && ev.Fingerprint != "" {
		startsAt := ev.StartsAt
		if startsAt == nil && !ev.CreatedAt.IsZero() {
			t := ev.CreatedAt
			startsAt = &t
		}
		if startsAt != nil {
			updates["occurrence_key"] = models.AlertEventOccurrenceKey(ev.Fingerprint, *startsAt)
		}
	}

	if len(updates) == 0 {
		return nil
	}
	if err := DB.Unscoped().Model(&models.AlertEvent{}).
		Where("id = ?", ev.ID).Updates(updates).Error; err != nil {
		return fmt.Errorf("migrate alert event %d: %w", ev.ID, err)
	}
	return nil
}

// ensureAlertEventOccurrenceIndex 创建 occurrence 去重唯一索引。
//
// 用部分唯一索引而非普通唯一索引：无指纹记录 occurrence_key 为空，不参与约束；
// 软删除行也不参与。若存量数据已有重复 occurrence_key，索引创建会失败并返回错误，
// 由部署方按日志清理后再启动（与本项目其他唯一索引的失败口径一致）。
func ensureAlertEventOccurrenceIndex() error {
	if err := DB.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_events_occurrence_key
		ON alert_events(occurrence_key)
		WHERE occurrence_key <> '' AND deleted_at IS NULL`).Error; err != nil {
		log.Printf("[db] create alert_events occurrence unique index failed: %v", err)
		return err
	}
	return nil
}
