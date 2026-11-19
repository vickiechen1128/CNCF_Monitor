package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3MonitorTypeRegistryAndCapabilities validates 0019 (M07 resource
// capabilities) and 0020 (M01 monitor type registry): tables exist, the
// uniqueness/index rules hold, and both migrations roll back cleanly.
func TestMigrateV3MonitorTypeRegistryAndCapabilities(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_monitor_types.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	requireTableCount(t, sqlDB, "m01_monitor_types", 1)
	requireTableCount(t, sqlDB, "m01_monitor_type_rules", 1)
	requireTableCount(t, sqlDB, "m07_attribute_definitions", 1)
	requireTableCount(t, sqlDB, "m07_resource_attributes", 1)

	// Host capability columns exist with a false default (FR-30).
	_, err = sqlDB.Exec(`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		VALUES ('d1','域1','edge','platform_admin','enabled')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO resources(
		resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key
	) VALUES ('h1','host','platform_admin','d1','PRD','online','manual',0,'host|d1|10.0.0.1')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
		VALUES ('h1','h1','10.0.0.1','Ubuntu')`)
	require.NoError(t, err)
	var hasNPU bool
	require.NoError(t, sqlDB.QueryRow(`SELECT has_npu FROM host_resources WHERE resource_id = 'h1'`).Scan(&hasNPU))
	require.False(t, hasNPU, "capability flags default to false, never inferred")

	// One definition per live code.
	_, err = sqlDB.Exec(`INSERT INTO m01_monitor_types(code,name,resource_category)
		VALUES ('host_linux','Linux','host')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_monitor_types(code,name,resource_category)
		VALUES ('host_linux','Linux again','host')`)
	require.Error(t, err, "duplicate live monitor type code must fail")

	// The operator vocabulary is constrained by the schema.
	_, err = sqlDB.Exec(`INSERT INTO m01_monitor_type_rules(id,monitor_type_code,field_name,match_operator,field_values)
		VALUES ('r1','host_linux','os_family','bogus','["linux"]')`)
	require.Error(t, err, "unknown match_operator must be rejected")

	_, err = sqlDB.Exec(`INSERT INTO m01_monitor_type_rules(id,monitor_type_code,field_name,match_operator,field_values)
		VALUES ('r1','host_linux','os_family','eq','["linux"]')`)
	require.NoError(t, err)

	// One value per (resource, attribute key).
	_, err = sqlDB.Exec(`INSERT INTO m07_attribute_definitions(id,attribute_key,display_name,value_type,resource_category)
		VALUES ('a1','dpu_model','DPU','text','host')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m07_resource_attributes(id,resource_id,attribute_key,value)
		VALUES ('ra1','h1','dpu_model','BlueField')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m07_resource_attributes(id,resource_id,attribute_key,value)
		VALUES ('ra2','h1','dpu_model','duplicate')`)
	require.Error(t, err, "duplicate resource attribute key must fail")

	// 0021 renames legacy npu rows to host_npu. Roll it back, write legacy rows
	// the way the previous build did, then re-apply and assert the rewrite.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback 0021 npu rename")
	_, err = sqlDB.Exec(`INSERT INTO m01_scrape_jobs(id,job_name,resource_category,network_domain_id,monitor_type)
		VALUES ('job-legacy','npu-prod','host','d1','npu')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_exporter_templates(
		id,name,version,default_port,metrics_path,scheme,supported_monitor_types,os,arch,
		download_url,homepage,install_guide,description,is_builtin,source)
		VALUES ('exp-legacy','npu-exporter','1.0',9101,'/metrics','http','["npu","host_linux"]',
		'linux','amd64','','','','',FALSE,'official')`)
	require.NoError(t, err)
	require.NoError(t, MigrateV3("sqlite", dsn), "re-apply 0021 npu rename")

	var jobMonitorType string
	require.NoError(t, sqlDB.QueryRow(`SELECT monitor_type FROM m01_scrape_jobs WHERE id = 'job-legacy'`).Scan(&jobMonitorType))
	require.Equal(t, "host_npu", jobMonitorType)
	var supported string
	require.NoError(t, sqlDB.QueryRow(`SELECT supported_monitor_types FROM m01_exporter_templates WHERE id = 'exp-legacy'`).Scan(&supported))
	require.Contains(t, supported, `"host_npu"`)
	require.NotContains(t, supported, `"npu"`)

	// Rollback both capability/registry migrations and re-apply.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback 0020 monitor type registry")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback 0019 resource capabilities")
	require.NoError(t, MigrateV3("sqlite", dsn), "re-apply both migrations")
}
