package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3MonitorTypeRegistryAndCapabilities validates 0019 (M07 resource
// capabilities) and 0020..0022 (M01 monitor type registry + NPU rename + CI
// model fields) as a historical slice.
//
// 0023 (collection templates) supersedes the registry: it drops these tables, so
// this test migrates up to 22. The 0023 data migration has its own test in
// collection_template_migration_test.go.
func TestMigrateV3MonitorTypeRegistryAndCapabilities(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_monitor_types.db")
	migrateV3UpTo(t, "sqlite", dsn, 22)

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

	// 0021 (npu -> host_npu rename) and 0022 (CI model fields) are exercised by
	// their own forward paths above/below; the registry itself is dropped by
	// 0023, so this historical test stops at schema 22.
	requireTableCount(t, sqlDB, "m01_monitor_types", 1)
}
