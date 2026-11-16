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
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status)
			VALUES ('mc-demo','演示采集域','edge','platform_admin','agent_pull','enabled')`,
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
		ResourceCategory: domain.CategoryHost, MonitorType: "host_linux",
		NetworkDomainID: "mc-demo", InstanceSelectionMode: domain.SelectionManual,
		SelectedInstanceIDs: []string{"res-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: domain.SchemeHTTP, AuthType: domain.AuthNone,
		DraftStatus: domain.DraftStatusReady, Enabled: true,
		Sync: domain.SyncState{Status: domain.SyncSynced},
	}
	require.NoError(t, jobRepo.Create(context.Background(), job))

	// M07 deletes the resource; M01 only sees it disappear on the next pull.
	require.NoError(t, gormDB.Exec(`UPDATE resources SET deleted_at = CURRENT_TIMESTAMP WHERE resource_id = 'res-1'`).Error)

	reconciler := NewReconcileService(jobRepo, references.NewResourceReader(gormDB), 0)
	changed, err := reconciler.ReconcileOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, changed)

	reloaded, err := jobRepo.Get(context.Background(), job.ID)
	require.NoError(t, err)
	assert.Empty(t, reloaded.SelectedInstanceIDs)
	assert.Equal(t, domain.SyncPending, reloaded.Sync.Status)
}
