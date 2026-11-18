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

func newRepoTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m09_repo.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, gormDB.Exec(
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains
		(id,name,domain_type,tenant_id,status,zone_type)
		VALUES ('mc-a','域 mc-a','edge','platform_admin','enabled','beijing')`).Error)
	return gormDB
}

func insertSnapshot(t *testing.T, repo *repository.GORMRepository, version string, created time.Time, current bool) int64 {
	t.Helper()
	rec := repository.ConfigSnapshot{
		NetworkDomainID:   "mc-a",
		Version:           version,
		Checksum:          "sha256:" + version,
		ValidationStatus:  "passed",
		ValidationCause:   "none",
		ValidationDetails: "{}",
		GeneratedBy:       "system",
		CreatedAt:         created,
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

// M08 告警配置留痕（am- 行）与采集配置快照同表。若保留策略按整表 created_at 取最新 N 条，
// 频繁保存告警配置会把真正的配置历史挤掉。两类必须分开计数。
func TestPruneSnapshotsKeepsConfigHistoryWhenAlertmanagerHistoryGrows(t *testing.T) {
	gormDB := newRepoTestDB(t)
	repo := repository.NewGORMRepository(gormDB)
	ctx := context.Background()
	base := time.Now().UTC().Add(-24 * time.Hour)

	// 先建立满窗的配置历史（7 条非当前 + 1 条当前），裁剪后应剩最新 5 条
	for i := 0; i < 7; i++ {
		insertSnapshot(t, repo, "cfg-"+string(rune('a'+i)), base.Add(time.Duration(i)*time.Minute), false)
	}
	insertSnapshot(t, repo, "cfg-current", base.Add(30*time.Minute), true)
	_, err := repo.PruneSnapshots(ctx, "mc-a", 5)
	require.NoError(t, err)

	configsBefore := filterVersions(listVersions(t, repo), false)
	require.Len(t, configsBefore, 5)

	// 之后频繁保存告警配置：8 条 am- 行，时间都比配置快照新
	for i := 0; i < 8; i++ {
		insertSnapshot(t, repo, "am-"+string(rune('a'+i)), base.Add(time.Duration(60+i)*time.Minute), false)
	}

	removed, err := repo.PruneSnapshots(ctx, "mc-a", 5)
	require.NoError(t, err)

	versions := listVersions(t, repo)
	assert.Equal(t, configsBefore, filterVersions(versions, false),
		"config history must not be evicted by alertmanager history")
	assert.Len(t, filterVersions(versions, true), 5, "alertmanager history keeps its own retention window")
	assert.Contains(t, versions, "cfg-current")
	assert.Len(t, removed, 3, "only the 3 oldest alertmanager rows exceed their own window")
}

// 当前生效版本即使超出保留数也不得删除（唯一 is_current）。
func TestPruneSnapshotsKeepsCurrentOutsideRetentionWindow(t *testing.T) {
	gormDB := newRepoTestDB(t)
	repo := repository.NewGORMRepository(gormDB)
	ctx := context.Background()
	base := time.Now().UTC().Add(-24 * time.Hour)

	// 最老的一条是当前生效版本，其后又产生了 6 条历史
	insertSnapshot(t, repo, "cfg-current", base, true)
	for i := 0; i < 6; i++ {
		insertSnapshot(t, repo, "cfg-"+string(rune('a'+i)), base.Add(time.Duration(i+1)*time.Minute), false)
	}

	_, err := repo.PruneSnapshots(ctx, "mc-a", 5)
	require.NoError(t, err)

	versions := listVersions(t, repo)
	assert.Contains(t, versions, "cfg-current", "current snapshot is never pruned")
	assert.Len(t, versions, 6, "5 newest + current outside the window")
}

// 没有 am- 行时行为保持原样：整表保留最新 keep 条 + 当前版本。
func TestPruneSnapshotsKeepsNewestConfigSnapshots(t *testing.T) {
	gormDB := newRepoTestDB(t)
	repo := repository.NewGORMRepository(gormDB)
	ctx := context.Background()
	base := time.Now().UTC().Add(-24 * time.Hour)

	for i := 0; i < 7; i++ {
		insertSnapshot(t, repo, "cfg-"+string(rune('a'+i)), base.Add(time.Duration(i)*time.Minute), false)
	}
	insertSnapshot(t, repo, "cfg-current", base.Add(30*time.Minute), true)

	removed, err := repo.PruneSnapshots(ctx, "mc-a", 5)
	require.NoError(t, err)
	assert.Len(t, removed, 3)
	assert.Len(t, listVersions(t, repo), 5)
}

// filterVersions 按版本前缀拆分两类快照（am- = M08 告警配置留痕）。
func filterVersions(versions []string, alertmanager bool) []string {
	out := make([]string, 0, len(versions))
	for _, version := range versions {
		isAlertmanager := len(version) > 3 && version[:3] == "am-"
		if isAlertmanager == alertmanager {
			out = append(out, version)
		}
	}
	return out
}
