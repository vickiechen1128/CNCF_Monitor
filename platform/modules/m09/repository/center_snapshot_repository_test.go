package repository_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

func newCenterRepoTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "center-prune.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	return gormDB
}

func insertCenterSnapshot(t *testing.T, repo *repository.GORMCenterSnapshotRepository, version string, created time.Time, status string, current bool) int64 {
	t.Helper()
	rec := repository.CenterConfigSnapshot{
		Version:          version,
		Checksum:         "sum-" + version,
		ValidationStatus: status,
		ValidationCause:  "none",
		CreatedAt:        created,
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
		id, err = repo.Insert(context.Background(), rec)
	}
	require.NoError(t, err)
	return id
}

func TestCenterSnapshotPruneKeepsOneSuccessPerDay(t *testing.T) {
	repo := repository.NewCenterSnapshotRepository(newCenterRepoTestDB(t))
	ctx := context.Background()
	loc := time.FixedZone("CST", 8*3600)
	now := time.Now().In(loc)
	day := func(offset int) time.Time {
		local := now.AddDate(0, 0, offset)
		return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	}

	// Today: two non-current successes and a failure; only the current row survives.
	insertCenterSnapshot(t, repo, "today-old", day(0).Add(1*time.Hour), "passed", false)
	insertCenterSnapshot(t, repo, "today-failed", day(0).Add(2*time.Hour), "failed", false)
	insertCenterSnapshot(t, repo, "today-current", day(0).Add(3*time.Hour), "passed", true)

	// Yesterday: two successes (keep newest) plus a failure (drop).
	insertCenterSnapshot(t, repo, "yesterday-old", day(-1).Add(1*time.Hour), "passed", false)
	insertCenterSnapshot(t, repo, "yesterday-new", day(-1).Add(2*time.Hour), "passed", false)
	insertCenterSnapshot(t, repo, "yesterday-failed", day(-1).Add(3*time.Hour), "failed", false)

	// Outside the 30-day window.
	insertCenterSnapshot(t, repo, "too-old", day(-31).Add(time.Hour), "passed", false)

	removed, err := repo.Prune(ctx, 30, loc)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{
		"today-old", "today-failed", "yesterday-old", "yesterday-failed", "too-old",
	}, removed)

	items, err := repo.List(ctx, 50)
	require.NoError(t, err)
	versions := make([]string, 0, len(items))
	for _, item := range items {
		versions = append(versions, item.Version)
	}
	assert.ElementsMatch(t, []string{"today-current", "yesterday-new"}, versions)

	current, err := repo.CurrentPassed(ctx)
	require.NoError(t, err)
	require.NotNil(t, current)
	assert.Equal(t, "today-current", current.Version)
}

func TestCenterSnapshotPruneKeepsCurrentOutsideWindow(t *testing.T) {
	repo := repository.NewCenterSnapshotRepository(newCenterRepoTestDB(t))
	ctx := context.Background()
	loc := time.FixedZone("CST", 8*3600)
	now := time.Now().In(loc)
	old := now.AddDate(0, 0, -40)

	insertCenterSnapshot(t, repo, "old-current", old, "passed", true)
	insertCenterSnapshot(t, repo, "recent", now, "passed", false)

	_, err := repo.Prune(ctx, 30, loc)
	require.NoError(t, err)

	items, err := repo.List(ctx, 50)
	require.NoError(t, err)
	versions := make([]string, 0, len(items))
	for _, item := range items {
		versions = append(versions, item.Version)
	}
	assert.Contains(t, versions, "old-current", "current snapshot is never pruned")
	assert.Contains(t, versions, "recent")
}
