package references

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestGORMScrapeJobCounter(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "scrape_jobs.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, domainID := range []string{"mc-demo", "mc-other"} {
		require.NoError(t, gormDB.Exec(
			`INSERT INTO network_domains(id,name,domain_type,tenant_id,status) VALUES (?,?,'edge','platform_admin','enabled')`,
			domainID, domainID,
		).Error)
	}
	for _, job := range []struct {
		id, domain string
		deleted    bool
	}{
		{"job-1", "mc-demo", false},
		{"job-2", "mc-demo", false},
		{"job-3", "mc-other", false},
		{"job-4", "mc-demo", true},
	} {
		deletedAt := "NULL"
		if job.deleted {
			deletedAt = "'2026-01-01 00:00:00'"
		}
		require.NoError(t, gormDB.Exec(
			`INSERT INTO m01_scrape_jobs(id,job_name,resource_category,network_domain_id,deleted_at) VALUES (?,?,?,?,`+deletedAt+`)`,
			job.id, job.id, "host", job.domain,
		).Error)
	}

	counter := NewGORMScrapeJobCounter(gormDB)
	count, err := counter.CountByDomain(context.Background(), "mc-demo")
	require.NoError(t, err)
	assert.EqualValues(t, 2, count, "只统计目标域下未软删的 job")

	count, err = counter.CountByDomain(context.Background(), "mc-other")
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)

	count, err = counter.CountByDomain(context.Background(), "missing")
	require.NoError(t, err)
	assert.EqualValues(t, 0, count)

	count, err = (NoopScrapeJobCounter{}).CountByDomain(context.Background(), "mc-demo")
	require.NoError(t, err)
	assert.EqualValues(t, 0, count)
}
