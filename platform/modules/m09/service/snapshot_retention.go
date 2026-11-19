package service

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultSnapshotRetentionDays keeps one successful config version per
	// natural day for a month (SRS v1.7 FR-13).
	DefaultSnapshotRetentionDays = 30
	// defaultSnapshotTimezone aligns the day boundary with the operations team's
	// local calendar; change via METRIC_CENTER_SNAPSHOT_TIMEZONE if needed.
	defaultSnapshotTimezone = "Asia/Shanghai"
)

// snapshotRetentionDays reads METRIC_CENTER_SNAPSHOT_RETENTION_DAYS.
// Invalid values fall back to the 30-day default instead of disabling pruning.
func snapshotRetentionDays() int {
	raw := strings.TrimSpace(os.Getenv("METRIC_CENTER_SNAPSHOT_RETENTION_DAYS"))
	if raw == "" {
		return DefaultSnapshotRetentionDays
	}
	days, err := strconv.Atoi(raw)
	if err != nil || days < 1 {
		log.Printf("m09: invalid METRIC_CENTER_SNAPSHOT_RETENTION_DAYS=%q; using %d", raw, DefaultSnapshotRetentionDays)
		return DefaultSnapshotRetentionDays
	}
	return days
}

// snapshotDayLocation reads METRIC_CENTER_SNAPSHOT_TIMEZONE. An invalid zone
// falls back to UTC so retention still has a deterministic boundary.
func snapshotDayLocation() *time.Location {
	name := strings.TrimSpace(os.Getenv("METRIC_CENTER_SNAPSHOT_TIMEZONE"))
	if name == "" {
		name = defaultSnapshotTimezone
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		log.Printf("m09: invalid METRIC_CENTER_SNAPSHOT_TIMEZONE=%q; using UTC", name)
		return time.UTC
	}
	return loc
}

func normalizeSnapshotRetention(days int) int {
	if days < 1 {
		return DefaultSnapshotRetentionDays
	}
	return days
}
