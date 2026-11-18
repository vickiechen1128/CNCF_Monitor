package references_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
)

// insertLabelTemplate inserts a v3 M07 label template row. mappings must be a
// JSON array string (the same payload M07 persists).
func insertLabelTemplate(t *testing.T, gormDB *gorm.DB, id, category string, isDefault bool, mappings string) {
	t.Helper()
	require.NoError(t, gormDB.Exec(`INSERT INTO m07_label_templates
		(id,name,resource_category,is_default,mappings)
		VALUES (?,?,?,?,?)`, id, id, category, isDefault, mappings).Error)
}

// ensureAppDict registers an application dictionary row so resources may
// reference the app_code (SQLite tests run with foreign_keys=on).
func ensureAppDict(t *testing.T, gormDB *gorm.DB, appCode string) {
	t.Helper()
	require.NoError(t, gormDB.Exec(`INSERT INTO application_dicts(app_code, app_name)
		VALUES (?,?)`, appCode, appCode).Error)
}

func jobLabels(t *testing.T, source configgen.Source, jobName string) map[string]string {
	t.Helper()
	for _, job := range source.Jobs {
		if job.Name != jobName {
			continue
		}
		require.Len(t, job.Targets, 1, "job %s should have exactly one target", jobName)
		return job.Targets[0].Labels
	}
	t.Fatalf("job %q not found in source", jobName)
	return nil
}

// 显式挂载的模板优先：resource_field / composite / transform=upper 均按契约展开。
func TestSourceReaderExpandsExplicitLabelTemplate(t *testing.T) {
	gormDB := newSourceTestDB(t)
	ensureAppDict(t, gormDB, "pay")
	require.NoError(t, gormDB.Exec(`UPDATE resources SET app_code = 'pay'
		WHERE resource_id = 'r-host'`).Error)
	insertLabelTemplate(t, gormDB, "lt-host", "host", false, `[
		{"source_field":"app_code","source_type":"resource_field","target_label":"app","enabled":true},
		{"source_field":"hostname","source_type":"resource_field","target_label":"hostname","enabled":true,"transform":"upper"},
		{"source_field":"instance_ip:port","source_type":"composite","target_label":"instance","enabled":true}
	]`)
	require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET label_template_id = 'lt-host' WHERE id = 'job-node'`).Error)

	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	labels := jobLabels(t, source, "node")
	assert.Equal(t, "r-host", labels["resource_id"], "system identity label is always injected")
	assert.Equal(t, "pay", labels["app"])
	assert.Equal(t, "WEB-01", labels["hostname"], "transform=upper is applied")
	assert.Equal(t, "10.0.0.1:9100", labels["instance"], "composite uses the resolved target address")

	// 其他 Job 未挂模板、该类别也无默认模板 ⇒ 只有 system 标签。
	assert.Equal(t, map[string]string{"resource_id": "r-db"}, jobLabels(t, source, "database"))
}

// Job 未显式挂模板时使用同类资源的 is_default 模板。
func TestSourceReaderFallsBackToCategoryDefaultTemplate(t *testing.T) {
	gormDB := newSourceTestDB(t)
	ensureAppDict(t, gormDB, "pay")
	require.NoError(t, gormDB.Exec(`UPDATE resources SET app_code = 'pay' WHERE resource_id = 'r-host'`).Error)
	insertLabelTemplate(t, gormDB, "lt-host-default", "host", true, `[
		{"source_field":"app_code","source_type":"resource_field","target_label":"app","enabled":true}
	]`)

	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	labels := jobLabels(t, source, "node")
	assert.Equal(t, "r-host", labels["resource_id"])
	assert.Equal(t, "pay", labels["app"])
	assert.Equal(t, map[string]string{"resource_id": "r-db"}, jobLabels(t, source, "database"),
		"the host default template must not leak into other categories")
}

// 显式模板优先于类别默认模板。
func TestSourceReaderExplicitTemplateWinsOverDefault(t *testing.T) {
	gormDB := newSourceTestDB(t)
	ensureAppDict(t, gormDB, "pay")
	require.NoError(t, gormDB.Exec(`UPDATE resources SET app_code = 'pay' WHERE resource_id = 'r-host'`).Error)
	insertLabelTemplate(t, gormDB, "lt-host-default", "host", true, `[
		{"source_field":"app_code","source_type":"resource_field","target_label":"default_app","enabled":true}
	]`)
	insertLabelTemplate(t, gormDB, "lt-host-explicit", "host", false, `[
		{"source_field":"app_code","source_type":"resource_field","target_label":"explicit_app","enabled":true}
	]`)
	require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET label_template_id = 'lt-host-explicit' WHERE id = 'job-node'`).Error)

	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	labels := jobLabels(t, source, "node")
	assert.Equal(t, "pay", labels["explicit_app"])
	assert.NotContains(t, labels, "default_app")
}

// 显式模板被软删 / 类别不匹配时回落类别默认模板（v2.56 解析优先级）。
func TestSourceReaderFallsBackToDefaultWhenExplicitUnusable(t *testing.T) {
	t.Run("soft deleted explicit template", func(t *testing.T) {
		gormDB := newSourceTestDB(t)
		ensureAppDict(t, gormDB, "pay")
		require.NoError(t, gormDB.Exec(`UPDATE resources SET app_code = 'pay' WHERE resource_id = 'r-host'`).Error)
		insertLabelTemplate(t, gormDB, "lt-host-default", "host", true, `[
			{"source_field":"app_code","source_type":"resource_field","target_label":"app","enabled":true}
		]`)
		insertLabelTemplate(t, gormDB, "lt-host-deleted", "host", false, `[
			{"source_field":"app_code","source_type":"resource_field","target_label":"stale","enabled":true}
		]`)
		require.NoError(t, gormDB.Exec(`UPDATE m07_label_templates SET deleted_at = CURRENT_TIMESTAMP
			WHERE id = 'lt-host-deleted'`).Error)
		require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET label_template_id = 'lt-host-deleted' WHERE id = 'job-node'`).Error)

		source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
		require.NoError(t, err)
		labels := jobLabels(t, source, "node")
		assert.Equal(t, "pay", labels["app"])
		assert.NotContains(t, labels, "stale")
	})

	t.Run("explicit template category mismatch", func(t *testing.T) {
		gormDB := newSourceTestDB(t)
		ensureAppDict(t, gormDB, "pay")
		require.NoError(t, gormDB.Exec(`UPDATE resources SET app_code = 'pay' WHERE resource_id = 'r-host'`).Error)
		insertLabelTemplate(t, gormDB, "lt-host-default", "host", true, `[
			{"source_field":"app_code","source_type":"resource_field","target_label":"app","enabled":true}
		]`)
		insertLabelTemplate(t, gormDB, "lt-db", "database", false, `[
			{"source_field":"database_type","source_type":"resource_field","target_label":"db_type","enabled":true}
		]`)
		require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET label_template_id = 'lt-db' WHERE id = 'job-node'`).Error)

		source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
		require.NoError(t, err)
		labels := jobLabels(t, source, "node")
		assert.Equal(t, "pay", labels["app"])
		assert.NotContains(t, labels, "db_type")
	})
}

// 拨测 Job 与标准 Job 共用同一模板解析；接口服务字段（api_name / api_url）按
// resource_field 展开。
func TestSourceReaderExpandsTemplateForBlackboxJob(t *testing.T) {
	gormDB := newSourceTestDB(t)
	insertLabelTemplate(t, gormDB, "lt-api-default", "interface_service", true, `[
		{"source_field":"api_name","source_type":"resource_field","target_label":"api_name","enabled":true},
		{"source_field":"api_url","source_type":"resource_field","target_label":"api_url","enabled":true}
	]`)

	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	labels := jobLabels(t, source, "api-probe")
	assert.Equal(t, "r-api", labels["resource_id"])
	assert.Equal(t, "order-api", labels["api_name"])
	assert.Equal(t, "http://10.0.0.4:8080/health", labels["api_url"])
	assert.Equal(t, "http://10.0.0.4:8080/health", source.Jobs[0].Targets[0].Instance)
}

// 无显式模板且类别无默认模板 ⇒ 仅 system 标签（至少 resource_id）。
func TestSourceReaderWithoutTemplateOnlySystemLabels(t *testing.T) {
	gormDB := newSourceTestDB(t)

	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	for _, job := range source.Jobs {
		for _, target := range job.Targets {
			assert.Equal(t, map[string]string{"resource_id": target.Labels["resource_id"]}, target.Labels)
		}
	}
}

// system 标签受保护：模板即使配置同名 target 也不能覆盖，Prometheus 内部标签
// （__ 前缀）即使绕过校验落库也会被丢弃。
func TestSourceReaderProtectsSystemLabels(t *testing.T) {
	gormDB := newSourceTestDB(t)
	insertLabelTemplate(t, gormDB, "lt-host", "host", false, `[
		{"source_field":"hostname","source_type":"resource_field","target_label":"resource_id","enabled":true},
		{"source_field":"hostname","source_type":"resource_field","target_label":"__bad","enabled":true}
	]`)
	require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET label_template_id = 'lt-host' WHERE id = 'job-node'`).Error)

	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	labels := jobLabels(t, source, "node")
	assert.Equal(t, "r-host", labels["resource_id"], "template must not override the system identity label")
	assert.NotContains(t, labels, "__bad")
}

// platform_code 留空时按所属应用 is_primary 平台兜底（决策 110 ③）；资源行
// 显式值优先于应用主平台（决策 110 ①）。
func TestSourceReaderPlatformFallsBackToPrimaryAppPlatform(t *testing.T) {
	gormDB := newSourceTestDB(t)
	require.NoError(t, gormDB.Exec(`INSERT INTO application_dicts(app_code, app_name)
		VALUES ('pay','支付应用')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO platform_dicts(platform_code, platform_name)
		VALUES ('cmp-primary','主平台')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO platform_dicts(platform_code, platform_name)
		VALUES ('cmp-own','自有平台')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO app_platform_rels
		(id, app_code, platform_code, is_primary) VALUES ('rel-1','pay','cmp-primary',TRUE)`).Error)
	insertLabelTemplate(t, gormDB, "lt-host", "host", false, `[
		{"source_field":"platform_code","source_type":"resource_field","target_label":"platform","enabled":true}
	]`)
	require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET label_template_id = 'lt-host' WHERE id = 'job-node'`).Error)

	require.NoError(t, gormDB.Exec(`UPDATE resources SET app_code = 'pay', platform_code = NULL
		WHERE resource_id = 'r-host'`).Error)
	source, err := references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)
	assert.Equal(t, "cmp-primary", jobLabels(t, source, "node")["platform"],
		"empty resource platform_code falls back to the app primary platform")

	require.NoError(t, gormDB.Exec(`UPDATE resources SET platform_code = 'cmp-own'
		WHERE resource_id = 'r-host'`).Error)
	source, err = references.NewGORMSourceReader(gormDB).BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)
	assert.Equal(t, "cmp-own", jobLabels(t, source, "node")["platform"],
		"the resource row value wins over the app primary platform")
}

// 模板是平台级配置：修改 / 软删都必须推进所有域的指纹，否则生成端不会重算标签。
func TestSourceReaderFingerprintAdvancesOnLabelTemplateChange(t *testing.T) {
	gormDB := newSourceTestDB(t)
	reader := references.NewGORMSourceReader(gormDB)
	ctx := context.Background()

	insertLabelTemplate(t, gormDB, "lt-host", "host", false, `[]`)
	before, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	require.False(t, before.IsZero())

	updatedAt := before.Add(time.Hour).UTC()
	require.NoError(t, gormDB.Exec(`UPDATE m07_label_templates SET updated_at = ? WHERE id = 'lt-host'`, updatedAt).Error)
	afterUpdate, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	assert.True(t, afterUpdate.After(before), "template update must advance the fingerprint")

	deletedAt := afterUpdate.Add(time.Hour).UTC()
	require.NoError(t, gormDB.Exec(`UPDATE m07_label_templates SET deleted_at = ? WHERE id = 'lt-host'`, deletedAt).Error)
	afterDelete, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	assert.True(t, afterDelete.After(afterUpdate), "template soft delete must advance the fingerprint")
}
