package db

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3CollectionTemplates covers 0023 (M01 collection templates):
// the schema lands, the legacy rows are migrated without losing their meaning,
// and the down migration restores the legacy shape.
func TestMigrateV3CollectionTemplates(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_collection_templates.db")

	// Build the pre-0023 schema and seed one full legacy chain: a monitor type,
	// its derivation rule, its default mapping, a job using it and a metric
	// anchored on it.
	migrateV3UpTo(t, "sqlite", dsn, 22)
	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)

	seed := []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('d1','域1','edge','platform_admin','enabled')`,
		`INSERT INTO m01_exporter_templates(
			id,name,version,default_port,metrics_path,scheme,supported_monitor_types,os,arch,
			download_url,homepage,install_guide,description,is_builtin,source)
			VALUES ('exp-mysql','mysqld-exporter','0.15',9104,'/metrics','http','["mysql"]',
			'linux','amd64','','','','',TRUE,'official')`,
		`INSERT INTO m01_monitor_types(code,name,resource_category,rule_logic,sort_order,enabled,is_builtin)
			VALUES ('mysql','MySQL','database','all',40,TRUE,TRUE)`,
		`INSERT INTO m01_monitor_type_rules(id,monitor_type_code,field_name,match_operator,field_values,priority)
			VALUES ('rule-mysql','mysql','database_type','eq','["mysql"]',10)`,
		`INSERT INTO m01_ci_type_exporter_mappings(
			id,monitor_type,exporter_template_id,is_default,default_port,metrics_path,scheme,
			scrape_interval,scrape_timeout,label_template_id,is_builtin)
			VALUES ('map-mysql','mysql','exp-mysql',TRUE,9104,'/metrics','http','15s','10s',NULL,TRUE)`,
		`INSERT INTO m01_scrape_jobs(id,job_name,resource_category,network_domain_id,monitor_type,exporter_template_id)
			VALUES ('job-mysql','mysql-prod','database','d1','mysql','exp-mysql')`,
		`INSERT INTO m01_metric_library(id,metric_name,metric_type,monitor_types)
			VALUES ('m1','mysql_up','gauge','[{"monitor_type":"mysql","source_exporter":"mysqld-exporter"}]')`,
	}
	for _, stmt := range seed {
		_, err := sqlDB.Exec(stmt)
		require.NoError(t, err, stmt)
	}
	require.NoError(t, sqlDB.Close())

	// Apply 0023.
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err = openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	// 1) Legacy tables are gone.
	for _, table := range []string{"m01_monitor_types", "m01_monitor_type_rules", "m01_ci_type_exporter_mappings"} {
		requireTableCount(t, sqlDB, table, 0)
	}

	// 2) The default mapping became a template that keeps code, category,
	//    exporter, parameters and builtin flag.
	var (
		name     string
		category string
		exporter string
		port     int
		builtin  bool
	)
	require.NoError(t, sqlDB.QueryRow(`SELECT name, resource_category, exporter_template_id,
		default_port, is_builtin FROM m01_collection_templates WHERE code = 'mysql'`).
		Scan(&name, &category, &exporter, &port, &builtin))
	require.Equal(t, "MySQL", name)
	require.Equal(t, "database", category)
	require.Equal(t, "exp-mysql", exporter)
	require.Equal(t, 9104, port)
	require.True(t, builtin)

	// 3) The job kept its meaning: template_code + the old rule as its selector.
	var templateCode, rawSelector string
	require.NoError(t, sqlDB.QueryRow(`SELECT template_code, selector FROM m01_scrape_jobs WHERE id = 'job-mysql'`).
		Scan(&templateCode, &rawSelector))
	require.Equal(t, "mysql", templateCode)
	var selector struct {
		Logic   string `json:"logic"`
		Filters []struct {
			Field    string   `json:"field"`
			Operator string   `json:"operator"`
			Values   []string `json:"values"`
		} `json:"filters"`
	}
	require.NoError(t, json.Unmarshal([]byte(rawSelector), &selector))
	require.Equal(t, "all", selector.Logic)
	require.Len(t, selector.Filters, 1)
	require.Equal(t, "database_type", selector.Filters[0].Field)
	require.Equal(t, "eq", selector.Filters[0].Operator)
	require.Equal(t, []string{"mysql"}, selector.Filters[0].Values)

	// 4) Metric anchors were renamed in place.
	var anchors string
	require.NoError(t, sqlDB.QueryRow(`SELECT collection_templates FROM m01_metric_library WHERE id = 'm1'`).
		Scan(&anchors))
	require.Contains(t, anchors, `"template_code":"mysql"`)
	require.NotContains(t, anchors, `"monitor_type"`)

	// 5) The exporter no longer declares supported types.
	_, err = sqlDB.Exec(`SELECT supported_monitor_types FROM m01_exporter_templates LIMIT 1`)
	require.Error(t, err, "supported_monitor_types must be dropped")

	// 6) Down restores the legacy shape (structure only).
	require.NoError(t, MigrateV3Down("sqlite", dsn))
	sqlDB2, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB2.Close()
	requireTableCount(t, sqlDB2, "m01_monitor_types", 1)
	requireTableCount(t, sqlDB2, "m01_ci_type_exporter_mappings", 1)
	var legacyMonitorType string
	require.NoError(t, sqlDB2.QueryRow(`SELECT monitor_type FROM m01_scrape_jobs WHERE id = 'job-mysql'`).
		Scan(&legacyMonitorType))
	require.Equal(t, "mysql", legacyMonitorType)
}
