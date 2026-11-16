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
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
)

func newSourceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m09_source.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status,zone_type)
			VALUES ('mc-a','域 mc-a','edge','platform_admin','agent_pull','enabled','beijing')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	insertResource := func(id, category string, scrapePort int, status, dedup string) {
		require.NoError(t, gormDB.Exec(`INSERT INTO resources
			(resource_id, resource_category, tenant_id, network_domain_id, env, status, source_type, scrape_port, dedup_key)
			VALUES (?,?,?,?,?,?,?,?,?)`,
			id, category, "platform_admin", "mc-a", "PRD", status, "manual", scrapePort, dedup).Error)
	}
	insertResource("r-host", "host", 0, "online", "host|mc-a|1")
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
		(resource_id, hostname, instance_ip, os_type) VALUES ('r-host','web-01','10.0.0.1','linux')`).Error)

	insertResource("r-db", "database", 0, "online", "db|mc-a|2")
	require.NoError(t, gormDB.Exec(`INSERT INTO database_resources
		(resource_id, database_type, instance_ip, port) VALUES ('r-db','mysql','10.0.0.2',3306)`).Error)

	insertResource("r-gen", "generic_target", 0, "online", "gen|mc-a|3")
	require.NoError(t, gormDB.Exec(`INSERT INTO generic_target_resources
		(resource_id, target_name, instance_ip, port, metrics_path, scheme, exporter_type)
		VALUES ('r-gen','redis','10.0.0.3',8080,'/metrics','http','redis_exporter')`).Error)

	insertResource("r-api", "interface_service", 0, "online", "api|mc-a|4")
	require.NoError(t, gormDB.Exec(`INSERT INTO interface_service_resources
		(resource_id, api_name, api_url) VALUES ('r-api','order-api','http://10.0.0.4:8080/health')`).Error)

	insertResource("r-offline", "host", 0, "offline", "host|mc-a|5")
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
		(resource_id, hostname, instance_ip, os_type) VALUES ('r-offline','web-02','10.0.0.9','linux')`).Error)

	// Default mapping ports: host 9100, mysql/generic fall back to the business port.
	for _, stmt := range []string{
		`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-node','node-exporter')`,
		`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-mysql','mysqld-exporter')`,
		`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-gen','snmp-exporter')`,
		`INSERT INTO m01_ci_type_exporter_mappings
			(id,monitor_type,exporter_template_id,is_default,default_port)
			VALUES ('map-host','host_linux','exp-node',TRUE,9100)`,
		`INSERT INTO m01_ci_type_exporter_mappings
			(id,monitor_type,exporter_template_id,is_default,default_port)
			VALUES ('map-mysql','mysql','exp-mysql',TRUE,0)`,
		`INSERT INTO m01_ci_type_exporter_mappings
			(id,monitor_type,exporter_template_id,is_default,default_port)
			VALUES ('map-gen','snmp','exp-gen',TRUE,0)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	insertJob := func(id, name, jobType, monitorType, category, ids string) {
		require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs
			(id,job_name,job_type,resource_category,monitor_type,network_domain_id,
			 selected_instance_ids,draft_status,enabled,scrape_interval,scrape_timeout,metrics_path,scheme)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id, name, jobType, category, monitorType, "mc-a", ids, "ready", true, "15s", "10s", "/metrics", "http").Error)
	}
	insertJob("job-node", "node", "standard", "host_linux", "host", `["r-host"]`)
	insertJob("job-db", "database", "standard", "mysql", "database", `["r-db"]`)
	insertJob("job-gen", "redis_exporter", "standard", "snmp", "generic_target", `["r-gen"]`)
	insertJob("job-api", "api-probe", "blackbox", "", "interface_service", `["r-api"]`)
	require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET blackbox_module = 'http_2xx' WHERE id = 'job-api'`).Error)

	return gormDB
}

func TestSourceReaderBuildsJobsFromM01(t *testing.T) {
	gormDB := newSourceTestDB(t)
	reader := references.NewGORMSourceReader(gormDB)

	source, err := reader.BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)
	assert.Equal(t, "beijing", source.ZoneType)
	require.Len(t, source.Jobs, 4)
	assert.Equal(t, []string{"api-probe", "database", "node", "redis_exporter"}, []string{
		source.Jobs[0].Name, source.Jobs[1].Name, source.Jobs[2].Name, source.Jobs[3].Name,
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

	probe := source.Jobs[byName["api-probe"]]
	assert.Equal(t, "http_2xx", probe.BlackboxModule)
	assert.Equal(t, "http://10.0.0.4:8080/health", probe.Targets[0].Instance)

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
