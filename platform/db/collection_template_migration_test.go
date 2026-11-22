package db

import (
	"database/sql"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3CollectionTemplates covers 0023 (M01 collection templates):
// the schema lands, the legacy rows are migrated without losing their meaning,
// and the down migration restores the legacy shape.
//
// It runs on PostgreSQL — the production dialect. The regression it guards
// against is exactly the SQLite-only blindness that shipped three defects:
// aggregate subqueries need an explicit GROUP BY, jsonb columns cannot be
// passed to replace() directly, and the job-group rewrite must not be missed.
func TestMigrateV3CollectionTemplates(t *testing.T) {
	dsn := testPostgresDSN(t)
	migrateV3UpTo(t, "postgres", dsn, 22)
	seedCollectionTemplateLegacy(t, dsn)
	require.NoError(t, MigrateV3("postgres", dsn))

	sqlDB := openTestSQL(t, dsn)
	verifyCollectionTemplateMigration(t, sqlDB)
	verifyCollectionTemplateDown(t, dsn)
}

// seedCollectionTemplateLegacy seeds one full legacy chain on the pre-0023
// schema: a monitor type, its derivation rule, its default mapping, a job group
// plus job using it, and a metric anchored on it.
func seedCollectionTemplateLegacy(t *testing.T, dsn string) {
	t.Helper()
	sqlDB := openTestSQL(t, dsn)

	seed := []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('d1','域1','edge','platform_admin','enabled')`,
		`INSERT INTO m01_exporter_templates(
			id,name,version,default_port,metrics_path,scheme,supported_monitor_types,os,arch,
			download_url,homepage,install_guide,description,is_builtin,source)
			VALUES ('exp-mysql','mysqld-exporter','0.15',9104,'/metrics','http','["mysql"]',
			'linux','amd64','','','','',TRUE,'official')`,
		`INSERT INTO m01_exporter_templates(
			id,name,version,default_port,metrics_path,scheme,supported_monitor_types,os,arch,
			download_url,homepage,install_guide,description,is_builtin,source)
			VALUES ('exp-mysql-alt','mysqld-exporter-alt','0.15',9104,'/metrics','http','["mysql"]',
			'linux','amd64','','','','',FALSE,'official')`,
		`INSERT INTO m01_monitor_types(code,name,resource_category,rule_logic,sort_order,enabled,is_builtin)
			VALUES ('mysql','MySQL','database','all',40,TRUE,TRUE)`,
		`INSERT INTO m01_monitor_type_rules(id,monitor_type_code,field_name,match_operator,field_values,priority)
			VALUES ('rule-mysql','mysql','database_type','eq','["mysql"]',10)`,
		`INSERT INTO m01_ci_type_exporter_mappings(
			id,monitor_type,exporter_template_id,is_default,default_port,metrics_path,scheme,
			scrape_interval,scrape_timeout,label_template_id,is_builtin)
			VALUES ('map-mysql','mysql','exp-mysql',TRUE,9104,'/metrics','http','15s','10s',NULL,TRUE)`,
		`INSERT INTO m01_ci_type_exporter_mappings(
			id,monitor_type,exporter_template_id,is_default,default_port,metrics_path,scheme,
			scrape_interval,scrape_timeout,label_template_id,is_builtin)
			VALUES ('map-mysql-alt','mysql','exp-mysql-alt',FALSE,9104,'/metrics','http','15s','10s',NULL,FALSE)`,
		`INSERT INTO m01_job_groups(id,name,job_type,resource_category,monitor_type,exporter_template_id)
			VALUES ('jg-mysql','mysql-fleet','standard','database','mysql','exp-mysql')`,
		`INSERT INTO m01_scrape_jobs(
			id,job_name,resource_category,network_domain_id,monitor_type,exporter_template_id,job_group_id)
			VALUES ('job-mysql','mysql-prod','database','d1','mysql','exp-mysql','jg-mysql')`,
		`INSERT INTO m01_metric_library(id,metric_name,metric_type,monitor_types)
			VALUES ('m1','mysql_up','gauge','[{"monitor_type":"mysql","source_exporter":"mysqld-exporter"}]')`,
	}
	for _, stmt := range seed {
		_, err := sqlDB.Exec(stmt)
		require.NoError(t, err, stmt)
	}
}

func verifyCollectionTemplateMigration(t *testing.T, sqlDB *sql.DB) {
	t.Helper()

	// 1) Legacy tables are gone.
	for _, table := range []string{"m01_monitor_types", "m01_monitor_type_rules", "m01_ci_type_exporter_mappings"} {
		requireLegacyTableGone(t, sqlDB, table)
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

	// The non-default mapping becomes a second template keyed
	// `<monitor_type>__<exporter_template_id>`.
	var derivedName string
	var derivedPort int
	require.NoError(t, sqlDB.QueryRow(`SELECT name, default_port FROM m01_collection_templates
		WHERE code = 'mysql__exp-mysql-alt'`).Scan(&derivedName, &derivedPort))
	require.Equal(t, "MySQL · mysqld-exporter-alt", derivedName)
	require.Equal(t, 9104, derivedPort)

	// 3) The job kept its meaning: template_code + the old rule as its selector,
	//    and the job group inherited both from its child job.
	assertSelector := func(raw string) {
		var selector struct {
			Logic   string `json:"logic"`
			Filters []struct {
				Field    string   `json:"field"`
				Operator string   `json:"operator"`
				Values   []string `json:"values"`
			} `json:"filters"`
		}
		require.NoError(t, json.Unmarshal([]byte(raw), &selector))
		require.Equal(t, "all", selector.Logic)
		require.Len(t, selector.Filters, 1)
		require.Equal(t, "database_type", selector.Filters[0].Field)
		require.Equal(t, "eq", selector.Filters[0].Operator)
		require.Equal(t, []string{"mysql"}, selector.Filters[0].Values)
	}

	var jobTemplateCode, jobSelector string
	require.NoError(t, sqlDB.QueryRow(
		`SELECT template_code, selector FROM m01_scrape_jobs WHERE id = 'job-mysql'`).
		Scan(&jobTemplateCode, &jobSelector))
	require.Equal(t, "mysql", jobTemplateCode)
	assertSelector(jobSelector)

	var groupTemplateCode, groupSelector string
	require.NoError(t, sqlDB.QueryRow(
		`SELECT template_code, selector FROM m01_job_groups WHERE id = 'jg-mysql'`).
		Scan(&groupTemplateCode, &groupSelector))
	require.Equal(t, "mysql", groupTemplateCode)
	assertSelector(groupSelector)

	// 4) Metric anchors were renamed in place (jsonb normalises the text form).
	var anchorsRaw string
	require.NoError(t, sqlDB.QueryRow(
		`SELECT collection_templates FROM m01_metric_library WHERE id = 'm1'`).Scan(&anchorsRaw))
	var anchors []map[string]any
	require.NoError(t, json.Unmarshal([]byte(anchorsRaw), &anchors))
	require.Len(t, anchors, 1)
	require.Equal(t, "mysql", anchors[0]["template_code"])
	require.NotContains(t, anchors[0], "monitor_type")

	// 5) The exporter no longer declares supported types.
	_, err := sqlDB.Exec(`SELECT supported_monitor_types FROM m01_exporter_templates LIMIT 1`)
	require.Error(t, err, "supported_monitor_types must be dropped")
}

// verifyCollectionTemplateDown restores the legacy shape (structure only).
func verifyCollectionTemplateDown(t *testing.T, dsn string) {
	t.Helper()
	require.NoError(t, MigrateV3DownTo("postgres", dsn, 22))

	sqlDB := openTestSQL(t, dsn)
	requireTableCount(t, sqlDB, "m01_monitor_types", 1)
	requireTableCount(t, sqlDB, "m01_ci_type_exporter_mappings", 1)

	var legacyMonitorType string
	require.NoError(t, sqlDB.QueryRow(
		`SELECT monitor_type FROM m01_scrape_jobs WHERE id = 'job-mysql'`).
		Scan(&legacyMonitorType))
	require.Equal(t, "mysql", legacyMonitorType)
}
