package edge

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

const (
	defaultHeartbeatRetentionDays = 7
	maxHeartbeatsPerDomain        = 100000
	heartbeatPurgeBatchSize       = 1000
	heartbeatRetentionInterval    = 24 * time.Hour
)

// PurgeHeartbeats 物理清理过期及超出单网域数量上限的心跳历史。
func PurgeHeartbeats(db *gorm.DB, now time.Time, retentionDays int) (int64, error) {
	return purgeHeartbeats(db, now, retentionDays, maxHeartbeatsPerDomain, heartbeatPurgeBatchSize)
}

func purgeHeartbeats(db *gorm.DB, now time.Time, retentionDays, maxPerDomain, batchSize int) (int64, error) {
	if db == nil {
		return 0, nil
	}
	if retentionDays <= 0 {
		retentionDays = defaultHeartbeatRetentionDays
	}
	if maxPerDomain <= 0 {
		maxPerDomain = maxHeartbeatsPerDomain
	}
	if batchSize <= 0 {
		batchSize = heartbeatPurgeBatchSize
	}

	deleted, err := purgeExpiredHeartbeats(db, now.AddDate(0, 0, -retentionDays), batchSize)
	if err != nil {
		return deleted, err
	}
	n, err := purgeExcessHeartbeats(db, maxPerDomain, batchSize)
	return deleted + n, err
}

func purgeExpiredHeartbeats(db *gorm.DB, cutoff time.Time, batchSize int) (int64, error) {
	var deleted int64
	for {
		ids := db.Model(&models.EdgeHeartbeat{}).Select("id").
			Where("timestamp < ?", cutoff).Order("id").Limit(batchSize)
		res := db.Unscoped().Where("id IN (?)", ids).Delete(&models.EdgeHeartbeat{})
		if res.Error != nil {
			return deleted, fmt.Errorf("purge expired edge heartbeats: %w", res.Error)
		}
		deleted += res.RowsAffected
		if res.RowsAffected == 0 {
			return deleted, nil
		}
	}
}

func purgeExcessHeartbeats(db *gorm.DB, maxPerDomain, batchSize int) (int64, error) {
	var domainIDs []string
	if err := db.Model(&models.EdgeHeartbeat{}).Distinct().Pluck("network_domain_id", &domainIDs).Error; err != nil {
		return 0, fmt.Errorf("list edge heartbeat domains: %w", err)
	}

	var deleted int64
	for _, domainID := range domainIDs {
		for {
			var ids []uint
			if err := db.Model(&models.EdgeHeartbeat{}).
				Where("network_domain_id = ?", domainID).
				Order("id DESC").Offset(maxPerDomain).Limit(batchSize).
				Pluck("id", &ids).Error; err != nil {
				return deleted, fmt.Errorf("select excess edge heartbeats for domain %s: %w", domainID, err)
			}
			if len(ids) == 0 {
				break
			}
			res := db.Unscoped().Where("id IN ?", ids).Delete(&models.EdgeHeartbeat{})
			if res.Error != nil {
				return deleted, fmt.Errorf("purge excess edge heartbeats for domain %s: %w", domainID, res.Error)
			}
			deleted += res.RowsAffected
		}
	}
	return deleted, nil
}

// StartHeartbeatRetention 启动心跳历史定期清理，随 ctx 取消退出。
func StartHeartbeatRetention(ctx context.Context, db *gorm.DB) {
	if db == nil {
		log.Printf("[edge-heartbeat] retention disabled (db is nil)")
		return
	}
	days := heartbeatRetentionDaysFromEnv()
	go func() {
		log.Printf("[edge-heartbeat] retention started, days=%d max_per_domain=%d interval=%s",
			days, maxHeartbeatsPerDomain, heartbeatRetentionInterval)
		purge := func() {
			n, err := PurgeHeartbeats(db, time.Now(), days)
			if err != nil {
				log.Printf("[edge-heartbeat] retention purge failed: %v", err)
				return
			}
			if n > 0 {
				log.Printf("[edge-heartbeat] retention purged %d rows", n)
			}
		}
		purge()
		ticker := time.NewTicker(heartbeatRetentionInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Printf("[edge-heartbeat] retention stopped")
				return
			case <-ticker.C:
				purge()
			}
		}
	}()
}

func heartbeatRetentionDaysFromEnv() int {
	raw := strings.TrimSpace(os.Getenv("EDGE_HEARTBEAT_RETENTION_DAYS"))
	if raw == "" {
		return defaultHeartbeatRetentionDays
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days <= 0 {
		log.Printf("[edge-heartbeat] invalid EDGE_HEARTBEAT_RETENTION_DAYS=%q, fallback to %d",
			raw, defaultHeartbeatRetentionDays)
		return defaultHeartbeatRetentionDays
	}
	return days
}
