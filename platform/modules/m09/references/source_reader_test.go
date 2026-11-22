package references_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

func newSourceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormDB := testdb.Open(t)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域 mc-a','edge','platform_admin','enabled')`,
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
		`INSERT INTO m01_collection_templates
			(code,name,resource_category,exporter_template_id,default_port)
			VALUES ('host_linux','Linux 主机采集','host','exp-node',9100)`,
		`INSERT INTO m01_collection_templates
			(code,name,resource_category,exporter_template_id,default_port)
			VALUES ('mysql','MySQL 采集','database','exp-mysql',0)`,
		`INSERT INTO m01_collection_templates
			(code,name,resource_category,exporter_template_id,default_port)
			VALUES ('snmp','网络设备采集','generic_target','exp-gen',0)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	insertJob := func(id, name, jobType, templateCode, category, ids string) {
		require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs
			(id,job_name,job_type,resource_category,template_code,network_domain_id,
			 selected_instance_ids,draft_status,enabled,scrape_interval,scrape_timeout,metrics_path,scheme)
			VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			id, name, jobType, category, templateCode, "mc-a", ids, "ready", true, "15s", "10s", "/metrics", "http").Error)
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

// M07 v3 的资源删除只写 deleted_at、不碰 updated_at，也不回写 Job；若指纹不覆盖
// deleted_at，删掉一个仍被 Job 引用的资源后本域不会重新生成配置（采集节点继续抓已删 target）。
func TestSourceReaderFingerprintAdvancesOnResourceSoftDelete(t *testing.T) {
	gormDB := newSourceTestDB(t)
	reader := references.NewGORMSourceReader(gormDB)
	ctx := context.Background()

	before, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	require.False(t, before.IsZero())

	deletedAt := before.Add(time.Hour).UTC()
	require.NoError(t, gormDB.Exec(
		`UPDATE resources SET deleted_at = ? WHERE resource_id = 'r-host'`, deletedAt).Error)

	after, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	assert.True(t, after.After(before),
		"resource soft delete must advance the fingerprint, otherwise the domain never re-syncs")
	assert.True(t, after.Equal(deletedAt), "fingerprint should reflect the newest soft delete")
}

// 探测模块（blackbox module）是平台全局配置：删除同样只写 deleted_at，需纳入指纹，
// 否则删除模块后各网域的 blackbox.yml 不会重新生成。
func TestSourceReaderFingerprintAdvancesOnProbeModuleSoftDelete(t *testing.T) {
	gormDB := newSourceTestDB(t)
	reader := references.NewGORMSourceReader(gormDB)
	ctx := context.Background()

	updatedAt := time.Now().UTC().Add(-2 * time.Hour)
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_probe_modules(id,name,content,enabled,updated_at)
		VALUES ('pm-http','http_2xx','prober: http',TRUE,?)`, updatedAt).Error)

	before, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	require.False(t, before.IsZero())

	deletedAt := before.Add(time.Hour).UTC()
	require.NoError(t, gormDB.Exec(
		`UPDATE m01_probe_modules SET deleted_at = ? WHERE id = 'pm-http'`, deletedAt).Error)

	after, err := reader.Fingerprint(ctx, "mc-a")
	require.NoError(t, err)
	assert.True(t, after.After(before),
		"probe module soft delete must advance the fingerprint")
}

// countingLogger 统计命中指定 SQL 片段的查询次数，用于验证扇出时没有查询放大。
type countingLogger struct {
	mu     sync.Mutex
	counts map[string]int
}

func (l *countingLogger) LogMode(logger.LogLevel) logger.Interface { return l }
func (l *countingLogger) Info(context.Context, string, ...any)     {}
func (l *countingLogger) Warn(context.Context, string, ...any)     {}
func (l *countingLogger) Error(context.Context, string, ...any)    {}
func (l *countingLogger) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, marker := range []string{"resource_id IN", "m01_collection_templates", "m01_exporter_templates"} {
		if strings.Contains(sql, marker) {
			l.counts[marker]++
		}
	}
}

func (l *countingLogger) count(marker string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.counts[marker]
}

// 域内 4 个 Job 共享资源：只在一次 IN 查询里取回；端口映射按 TTL 缓存，
// 第二次构建同一域时不再重复查映射表（扇出 N 域时这是最容易被放大的部分）。
func TestSourceReaderFansOutWithoutQueryAmplification(t *testing.T) {
	gormDB := newSourceTestDB(t)
	counter := &countingLogger{counts: map[string]int{}}
	reader := references.NewGORMSourceReader(gormDB.Session(&gorm.Session{Logger: counter}))
	ctx := context.Background()

	_, err := reader.BuildSource(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, 1, counter.count("resource_id IN"), "resources are fetched once per domain, not once per job")
	assert.Equal(t, 1, counter.count("m01_collection_templates"))
	assert.Equal(t, 1, counter.count("m01_exporter_templates"))

	_, err = reader.BuildSource(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, 1, counter.count("m01_collection_templates"), "template ports come from the TTL cache")
	assert.Equal(t, 1, counter.count("m01_exporter_templates"))
}

func TestSourceReaderExcludesResourceMovedToAnotherDomain(t *testing.T) {
	gormDB := newSourceTestDB(t)
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		VALUES ('mc-b','域 mc-b','edge','platform_admin','enabled')`).Error)
	require.NoError(t, gormDB.Exec(`UPDATE resources SET network_domain_id = 'mc-b' WHERE resource_id = 'r-host'`).Error)

	reader := references.NewGORMSourceReader(gormDB)
	source, err := reader.BuildSource(context.Background(), "mc-a")
	require.NoError(t, err)

	for _, job := range source.Jobs {
		if job.Name == "node" {
			assert.Empty(t, job.Targets, "a resource moved out of the domain must not leak into its targets")
			return
		}
	}
	t.Fatal("node job not found")
}
