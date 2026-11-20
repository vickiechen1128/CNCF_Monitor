package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3M01Strategy validates the 00006 M01 schema: tables, partial
// uniqueness, foreign keys and rollback.
func TestMigrateV3M01Strategy(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_m01.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	tables := []string{
		"m01_exporter_templates", "m01_collection_templates",
		"m01_scrape_jobs", "m01_monitoring_rules", "m01_metric_library",
		"m01_business_metrics", "m01_installations", "m01_probe_modules",
	}
	for _, table := range tables {
		requireTableCount(t, sqlDB, table, 1)
	}

	_, err = sqlDB.Exec(`INSERT INTO network_domains(
			id,name,domain_type,tenant_id,authorized_tenant_ids,status
		) VALUES (
			'dom-m01','策略域','edge','platform_admin','["platform_admin"]','enabled'
		)`)
	require.NoError(t, err)

	// --- exporter pool: unique name among live rows ---
	_, err = sqlDB.Exec(`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-1','node-exporter')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-2','node-exporter')`)
	require.Error(t, err, "duplicate live exporter name must fail")
	_, err = sqlDB.Exec(`UPDATE m01_exporter_templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'exp-1'`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-3','node-exporter')`)
	require.NoError(t, err, "soft-deleted name can be reused")

	// --- collection templates: code uniqueness + exporter FK ---
	_, err = sqlDB.Exec(`INSERT INTO m01_collection_templates(
			code,name,resource_category,exporter_template_id
		) VALUES ('host_linux','Linux 主机采集','host','exp-3')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_collection_templates(
			code,name,resource_category,exporter_template_id
		) VALUES ('host_linux','Linux 主机采集（重复）','host','exp-3')`)
	require.Error(t, err, "duplicate live template code must fail")
	_, err = sqlDB.Exec(`INSERT INTO m01_collection_templates(
			code,name,resource_category,exporter_template_id
		) VALUES ('unbound','未绑定采集实现','host','')`)
	require.NoError(t, err, "a template may be seeded before its exporter is registered")

	// --- jobs: unique job_name, network-domain FK, enum checks ---
	_, err = sqlDB.Exec(`INSERT INTO m01_scrape_jobs(
			id,job_name,resource_category,network_domain_id
		) VALUES ('job-1','node','host','dom-m01')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_scrape_jobs(
			id,job_name,resource_category,network_domain_id
		) VALUES ('job-2','node','host','dom-m01')`)
	require.Error(t, err, "duplicate live job_name must fail")
	_, err = sqlDB.Exec(`INSERT INTO m01_scrape_jobs(
			id,job_name,resource_category,network_domain_id
		) VALUES ('job-3','orphan','host','missing-domain')`)
	require.Error(t, err, "job must reference an existing network domain")
	_, err = sqlDB.Exec(`INSERT INTO m01_scrape_jobs(
			id,job_name,resource_category,network_domain_id,job_type
		) VALUES ('job-4','bad-type','host','dom-m01','sidecar')`)
	require.Error(t, err, "unknown job_type must be rejected")

	// --- rules: platform-global, central scope only ---
	_, err = sqlDB.Exec(`INSERT INTO m01_monitoring_rules(id,rule_content) VALUES ('rule-1','groups: []')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_monitoring_rules(id,scope) VALUES ('rule-2','edge')`)
	require.Error(t, err, "only central scope is allowed in v3")

	// --- metric catalogue: built-in name uniqueness ---
	_, err = sqlDB.Exec(`INSERT INTO m01_metric_library(id,metric_name,metric_type,is_builtin)
		VALUES ('metric-1','node_cpu_usage','gauge',TRUE)`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_metric_library(id,metric_name,metric_type,is_builtin)
		VALUES ('metric-2','node_cpu_usage','gauge',TRUE)`)
	require.Error(t, err, "duplicate built-in metric name must fail")

	// --- business metrics: unique metric_id and metric_name ---
	_, err = sqlDB.Exec(`INSERT INTO m01_business_metrics(id,metric_id,metric_name)
		VALUES ('biz-1','biz.order.count','order_count')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_business_metrics(id,metric_id,metric_name)
		VALUES ('biz-2','biz.order.count','order_count_2')`)
	require.Error(t, err, "duplicate business metric_id must fail")

	// --- installations: one note per (resource, job) ---
	_, err = sqlDB.Exec(`INSERT INTO m01_installations(id,resource_id,scrape_job_id)
		VALUES ('inst-1','res-1','job-1')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_installations(id,resource_id,scrape_job_id)
		VALUES ('inst-2','res-1','job-1')`)
	require.Error(t, err, "duplicate installation note must fail")

	// --- probe modules: unique name among live rows ---
	_, err = sqlDB.Exec(`INSERT INTO m01_probe_modules(id,name,content) VALUES ('probe-1','http_2xx','http_2xx: {}')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m01_probe_modules(id,name,content) VALUES ('probe-2','http_2xx','http_2xx: {}')`)
	require.Error(t, err, "duplicate probe module name must fail")

	// --- Down: roll back every migration above 00005 (all M01/M05/M07/M08/M09
	// tables), using a version target so later no-op migrations (0014 legacy
	// column drop, 0015 M01 nullable FKs) cannot leave stale M01 tables behind.
	// M06/M09 core tables (<= 00005) stay. ---
	require.NoError(t, MigrateV3DownTo("sqlite", dsn, 5))
	for _, table := range tables {
		requireTableCount(t, sqlDB, table, 0)
	}
	requireTableCount(t, sqlDB, "network_domains", 1)
	requireTableCount(t, sqlDB, "config_snapshots", 1)
}
