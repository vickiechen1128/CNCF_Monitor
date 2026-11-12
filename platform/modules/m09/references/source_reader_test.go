package references_test

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
)

func newSourceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m09_source.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		IsPlatformAdmin: true, Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-a", Name: "域 mc-a", DomainType: models.DomainTypeEdge,
		ZoneType: "beijing", CloudCode: "aliyun", TenantID: models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Channel:             models.ChannelTypeAgentPull, Status: models.DomainStatusEnabled,
	}).Error)

	insertResource := func(id, category string, scrapePort int, status, dedup string) {
		require.NoError(t, gormDB.Exec(`INSERT INTO resources
			(resource_id, resource_category, tenant_id, network_domain_id, env, status, source_type, scrape_port, dedup_key)
			VALUES (?,?,?,?,?,?,?,?,?)`,
			id, category, models.PlatformAdminTenantID, "mc-a", "PRD", status, "manual", scrapePort, dedup).Error)
	}
	insertResource("r-host", "host", 9100, "online", "host|mc-a|1")
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
		(resource_id, hostname, instance_ip, os_type) VALUES ('r-host','web-01','10.0.0.1','linux')`).Error)

	insertResource("r-db", "database", 0, "online", "db|mc-a|2")
	require.NoError(t, gormDB.Exec(`INSERT INTO database_resources
		(resource_id, database_type, instance_ip, port) VALUES ('r-db','mysql','10.0.0.2',3306)`).Error)

	insertResource("r-gen", "generic_target", 0, "online", "gen|mc-a|3")
	require.NoError(t, gormDB.Exec(`INSERT INTO generic_target_resources
		(resource_id, target_name, instance_ip, port, metrics_path, scheme, exporter_type)
		VALUES ('r-gen','redis','10.0.0.3',8080,'/metrics','http','redis_exporter')`).Error)

	// Offline hosts are excluded from the scrape source.
	insertResource("r-offline", "host", 9100, "offline", "host|mc-a|4")
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
		(resource_id, hostname, instance_ip, os_type) VALUES ('r-offline','web-02','10.0.0.9','linux')`).Error)

	return gormDB
}

func TestSourceReaderBuildsJobs(t *testing.T) {
	gormDB := newSourceTestDB(t)
	reader := references.NewGORMSourceReader(gormDB)

	source, err := reader.BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)
	assert.Equal(t, "beijing", source.ZoneType)
	require.Len(t, source.Jobs, 3)
	assert.Equal(t, []string{"database", "node", "redis_exporter"}, []string{
		source.Jobs[0].Name, source.Jobs[1].Name, source.Jobs[2].Name,
	})

	byName := map[string]int{}
	for i, job := range source.Jobs {
		byName[job.Name] = i
	}
	assert.Equal(t, "10.0.0.1:9100", source.Jobs[byName["node"]].Targets[0].Instance)
	assert.Equal(t, "10.0.0.2:3306", source.Jobs[byName["database"]].Targets[0].Instance)
	generic := source.Jobs[byName["redis_exporter"]]
	assert.Equal(t, "10.0.0.3:8080", generic.Targets[0].Instance)
	assert.Equal(t, "/metrics", generic.MetricsPath)
	assert.Equal(t, "http", generic.Scheme)

	for _, job := range source.Jobs {
		for _, target := range job.Targets {
			assert.NotEqual(t, "10.0.0.9:9100", target.Instance, "offline resources are excluded")
		}
	}
}

func TestSourceReaderFingerprintAndDomains(t *testing.T) {
	gormDB := newSourceTestDB(t)
	reader := references.NewGORMSourceReader(gormDB)

	fingerprint, err := reader.Fingerprint(context.Background(), "mc-a")
	require.NoError(t, err)
	assert.False(t, fingerprint.IsZero())

	domains, err := reader.EdgeDomainIDs(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{"mc-a"}, domains)

	empty, err := reader.Fingerprint(context.Background(), "mc-b")
	require.NoError(t, err)
	assert.True(t, empty.IsZero())
}
