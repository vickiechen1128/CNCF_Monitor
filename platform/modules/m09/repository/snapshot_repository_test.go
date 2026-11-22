package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

func newRepoTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormDB := testdb.Open(t)
	require.NoError(t, gormDB.Exec(
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains
		(id,name,domain_type,tenant_id,status,zone_type)
		VALUES ('mc-a','域 mc-a','edge','platform_admin','enabled','beijing')`).Error)
	return gormDB
}

func insertSnapshot(t *testing.T, repo *repository.GORMRepository, version string, created time.Time, current bool) int64 {
	return insertSnapshotWithStatus(t, repo, version, created, "passed", current)
}

func insertSnapshotWithStatus(t *testing.T, repo *repository.GORMRepository, version string, created time.Time, status string, current bool) int64 {
	t.Helper()
	rec := repository.ConfigSnapshot{
		NetworkDomainID:   "mc-a",
		Version:           version,
		Checksum:          "sha256:" + version,
		ValidationStatus:  status,
		ValidationCause:   "none",
		ValidationDetails: "{}",
		GeneratedBy:       "system",
		CreatedAt:         created,
	}
	if status != "passed" {
		rec.ValidationCause = "platform_fault"
	}
	var (
		id  int64
		err error
	)
	if current {
		id, err = repo.InsertAndActivate(context.Background(), rec)
	} else {
		id, err = repo.InsertSnapshot(context.Background(), rec)
	}
	require.NoError(t, err)
	return id
}

func listVersions(t *testing.T, repo *repository.GORMRepository) []string {
	t.Helper()
	items, err := repo.ListSnapshots(context.Background(), "mc-a", 100)
	require.NoError(t, err)
	versions := make([]string, 0, len(items))
	for _, item := range items {
		versions = append(versions, item.Version)
	}
	return versions
}

// Every family keeps at most one successful snapshot per natural day; failed
// attempts and intra-day duplicates are removed.
func TestPruneSnapshotsKeepsOneSuccessPerDay(t *testing.T) {
	gormDB := newRepoTestDB(t)
	repo := repository.NewGORMRepository(gormDB)
	ctx := context.Background()
	loc := time.FixedZone("CST", 8*3600)
	now := time.Now().In(loc)
	day := func(offset int) time.Time {
		local := now.AddDate(0, 0, offset)
		return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	}

	// Today: two config successes + a failure; current wins.
	insertSnapshot(t, repo, "cfg-today-old", day(0).Add(time.Hour), false)
	insertSnapshotWithStatus(t, repo, "cfg-today-failed", day(0).Add(2*time.Hour), "failed", false)
	insertSnapshot(t, repo, "cfg-current", day(0).Add(3*time.Hour), true)

	// Yesterday: two config successes (keep newest) + a failure (drop).
	insertSnapshot(t, repo, "cfg-yesterday-old", day(-1).Add(time.Hour), false)
	insertSnapshot(t, repo, "cfg-yesterday-new", day(-1).Add(2*time.Hour), false)
	insertSnapshotWithStatus(t, repo, "cfg-yesterday-failed", day(-1).Add(3*time.Hour), "failed", false)

	// Legacy alertmanager family is counted independently.
	insertSnapshot(t, repo, "am-today-old", day(0).Add(time.Hour), false)
	insertSnapshot(t, repo, "am-today-new", day(0).Add(2*time.Hour), false)
	insertSnapshot(t, repo, "am-yesterday", day(-1).Add(time.Hour), false)

	// Outside the 30-day window.
	insertSnapshot(t, repo, "cfg-too-old", day(-31).Add(time.Hour), false)
	insertSnapshot(t, repo, "am-too-old", day(-31).Add(time.Hour), false)

	removed, err := repo.PruneSnapshots(ctx, "mc-a", 30, loc)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{
		"cfg-today-old", "cfg-today-failed", "cfg-yesterday-old", "cfg-yesterday-failed",
		"am-today-old", "cfg-too-old", "am-too-old",
	}, removed)

	versions := listVersions(t, repo)
	assert.ElementsMatch(t, []string{
		"cfg-current", "cfg-yesterday-new", "am-today-new", "am-yesterday",
	}, versions)
}

// 当前生效版本即使超出保留窗口也不得删除（唯一 is_current）。
func TestPruneSnapshotsKeepsCurrentOutsideRetentionWindow(t *testing.T) {
	gormDB := newRepoTestDB(t)
	repo := repository.NewGORMRepository(gormDB)
	ctx := context.Background()
	loc := time.FixedZone("CST", 8*3600)
	now := time.Now().In(loc)

	insertSnapshot(t, repo, "cfg-current", now.AddDate(0, 0, -40), true)
	insertSnapshot(t, repo, "cfg-recent", now, false)

	_, err := repo.PruneSnapshots(ctx, "mc-a", 30, loc)
	require.NoError(t, err)

	versions := listVersions(t, repo)
	assert.ElementsMatch(t, []string{"cfg-current", "cfg-recent"}, versions,
		"current snapshot is never pruned")
}
