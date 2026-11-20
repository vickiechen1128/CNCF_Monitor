package service

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

func TestReconcileReclaimsMissingInstances(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "m01_reconcile.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-1','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.0.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-1','web-01','10.0.0.1','linux')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	jobRepo := repository.NewJobRepository(gormDB)
	job := &domain.Job{
		JobName: "host-prod", JobType: domain.JobTypeStandard,
		ResourceCategory: domain.CategoryHost, TemplateCode: "host_linux",
		NetworkDomainID: "mc-demo", InstanceSelectionMode: domain.SelectionManual,
		SelectedInstanceIDs: []string{"res-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: domain.SchemeHTTP, AuthType: domain.AuthNone,
		DraftStatus: domain.DraftStatusReady, Enabled: true,
		Sync: domain.SyncState{Status: domain.SyncSynced},
	}
	require.NoError(t, jobRepo.Create(context.Background(), job))

	// M07 deletes the resource; M01 only sees it disappear on the next pull.
	require.NoError(t, gormDB.Exec(`UPDATE resources SET deleted_at = CURRENT_TIMESTAMP WHERE resource_id = 'res-1'`).Error)

	reconciler := NewReconcileService(jobRepo, references.NewResourceReader(gormDB), references.NewDomainReader(gormDB), 0)
	changed, err := reconciler.ReconcileOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, changed)

	reloaded, err := jobRepo.Get(context.Background(), job.ID)
	require.NoError(t, err)
	assert.Empty(t, reloaded.SelectedInstanceIDs)
	assert.Equal(t, domain.SyncPending, reloaded.Sync.Status)
}

// SRS JG v1.0 FR-JG-07：域被禁用 → 组内子 Job 自动停用并留在库里；单域 Job 不受影响。
func TestReconcileDisablesGroupChildrenWhenDomainUnavailable(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "m01_reconcile_domain.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO network_domain_access(domain_id,token_hash,registration_status)
			VALUES ('mc-a','hash','monitored')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-b','域B','edge','platform_admin','enabled')`,
		`INSERT INTO network_domain_access(domain_id,token_hash,registration_status)
			VALUES ('mc-b','hash2','monitored')`,
		`INSERT INTO m01_job_groups(id,name,resource_category,status,created_by)
			VALUES ('grp-1','主机基础采集','host','enabled','admin')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-b1','host','platform_admin','mc-b','PRD','online','manual',0,'host|mc-b|10.9.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-b1','web-b1','10.9.0.1','linux')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-b2','host','platform_admin','mc-b','PRD','online','manual',0,'host|mc-b|10.9.0.2')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-b2','web-b2','10.9.0.2','linux')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	jobRepo := repository.NewJobRepository(gormDB)
	groupedChild := &domain.Job{
		JobName: "host-base", JobType: domain.JobTypeStandard,
		ResourceCategory: domain.CategoryHost, TemplateCode: "host_linux",
		NetworkDomainID: "mc-b", InstanceSelectionMode: domain.SelectionManual,
		SelectedInstanceIDs: []string{"res-b1"},
		ScrapeInterval:      "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics",
		Scheme: domain.SchemeHTTP, AuthType: domain.AuthNone,
		DraftStatus: domain.DraftStatusReady, Enabled: true,
		Sync: domain.SyncState{Status: domain.SyncSynced}, JobGroupID: "grp-1",
	}
	require.NoError(t, jobRepo.Create(context.Background(), groupedChild))
	standalone := &domain.Job{
		JobName: "standalone", JobType: domain.JobTypeStandard,
		ResourceCategory: domain.CategoryHost, TemplateCode: "host_linux",
		NetworkDomainID: "mc-b", InstanceSelectionMode: domain.SelectionManual,
		SelectedInstanceIDs: []string{"res-b2"},
		ScrapeInterval:      "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics",
		Scheme: domain.SchemeHTTP, AuthType: domain.AuthNone,
		DraftStatus: domain.DraftStatusReady, Enabled: true,
		Sync: domain.SyncState{Status: domain.SyncSynced},
	}
	require.NoError(t, jobRepo.Create(context.Background(), standalone))

	// M06 禁用域 B（M09 纳管态仍在，但域不可用）
	require.NoError(t, gormDB.Exec(`UPDATE network_domains SET status = 'disabled' WHERE id = 'mc-b'`).Error)

	reconciler := NewReconcileService(jobRepo, references.NewResourceReader(gormDB), references.NewDomainReader(gormDB), 0)
	changed, err := reconciler.ReconcileOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, changed, "only the grouped child is auto-disabled")

	child, err := jobRepo.Get(context.Background(), groupedChild.ID)
	require.NoError(t, err)
	assert.False(t, child.Enabled)
	assert.Equal(t, domain.SyncDraft, child.Sync.Status)

	other, err := jobRepo.Get(context.Background(), standalone.ID)
	require.NoError(t, err)
	assert.True(t, other.Enabled, "standalone jobs keep their explicit state")
}
