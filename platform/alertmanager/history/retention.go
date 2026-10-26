// retention.go 负责历史告警的保留与清理：
//
//	alert_events 只增不减会无限膨胀，按「关闭时间」保留最近 N 天终态记录；
//	未结行（firing/silenced/inhibited）永不清理，避免把仍在告警的问题删掉。
//
// 保留天数由 ALERT_EVENT_RETENTION_DAYS 配置，默认 180 天；启动先清一次，
// 之后每 24 小时清理一次。
package history

import (
	"context"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

const (
	// defaultRetentionDays 是历史告警默认保留天数。
	defaultRetentionDays = 180
	// retentionInterval 是清理周期。
	retentionInterval = 24 * time.Hour
)

// PurgeExpired 删除 closed_at 早于保留截止时间的终态记录（未结行不删）。
// now 与 retainedDays 由调用方传入，便于测试固定时间。
func PurgeExpired(db *gorm.DB, now time.Time, retentionDays int) (int64, error) {
	if db == nil {
		return 0, nil
	}
	if retentionDays <= 0 {
		retentionDays = defaultRetentionDays
	}
	cutoff := models.NormalizeAlertEventTime(now.AddDate(0, 0, -retentionDays))
	res := db.Unscoped().
		Where("status IN ? AND closed_at IS NOT NULL AND closed_at < ?",
			models.AlertEventTerminalStatuses, cutoff).
		Delete(&models.AlertEvent{})
	return res.RowsAffected, res.Error
}

// StartRetention 在独立 goroutine 中按天清理过期历史告警，随 ctx 取消退出。
func StartRetention(ctx context.Context, db *gorm.DB) {
	if db == nil {
		log.Printf("[alert-history] retention disabled (db is nil)")
		return
	}
	days := retentionDaysFromEnv()
	go func() {
		log.Printf("[alert-history] retention started, days=%d interval=%s", days, retentionInterval)
		purge := func() {
			n, err := PurgeExpired(db, time.Now(), days)
			if err != nil {
				log.Printf("[alert-history] retention purge failed: %v", err)
				return
			}
			if n > 0 {
				log.Printf("[alert-history] retention purged %d expired alert events", n)
			}
		}
		purge()
		ticker := time.NewTicker(retentionInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Printf("[alert-history] retention stopped")
				return
			case <-ticker.C:
				purge()
			}
		}
	}()
}

// retentionDaysFromEnv 读取 ALERT_EVENT_RETENTION_DAYS，非法值回落默认 180。
func retentionDaysFromEnv() int {
	raw := strings.TrimSpace(os.Getenv("ALERT_EVENT_RETENTION_DAYS"))
	if raw == "" {
		return defaultRetentionDays
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		log.Printf("[alert-history] invalid ALERT_EVENT_RETENTION_DAYS=%q, fallback to %d", raw, defaultRetentionDays)
		return defaultRetentionDays
	}
	return n
}
