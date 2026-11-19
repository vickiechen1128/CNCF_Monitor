package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func assertNotFound(t *testing.T, err error) {
	t.Helper()
	var nf *domain.NotFoundError
	require.ErrorAs(t, err, &nf)
}

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormDB := testdb.Open(t)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	return gormDB
}

func newExporter(name string) *domain.ExporterTemplate {
	return &domain.ExporterTemplate{
		Name:        name,
		MetricsPath: "/metrics",
		Scheme:      domain.SchemeHTTP,
		OS:          "any",
		Arch:        "any",
		Source:      domain.ExporterThirdParty,
	}
}

func newJob(name string) *domain.Job {
	return &domain.Job{
		JobName:               name,
		JobType:               domain.JobTypeStandard,
		ResourceCategory:      domain.CategoryHost,
		MonitorType:           "host_linux",
		NetworkDomainID:       "mc-demo",
		InstanceSelectionMode: domain.SelectionManual,
		SelectedInstanceIDs:   []string{"res-1", "res-2"},
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                domain.SchemeHTTP,
		AuthType:              domain.AuthNone,
		MappingOverrides:      []domain.MappingOverride{{Field: "scrape_interval", Value: "15s"}},
		DraftStatus:           domain.DraftStatusReady,
		Enabled:               true,
		Sync:                  domain.SyncState{Status: domain.SyncPending},
	}
}

func TestExporterTemplateRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewExporterTemplateRepository(gormDB)
	ctx := context.Background()

	template := newExporter("custom-exporter")
	template.SupportedMonitorTypes = []string{"host_linux"}
	require.NoError(t, repo.Create(ctx, template))
	assert.NotEmpty(t, template.ID)
	assert.False(t, template.CreatedAt.IsZero())

	got, err := repo.Get(ctx, template.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"host_linux"}, got.SupportedMonitorTypes)

	byName, err := repo.GetByName(ctx, "custom-exporter")
	require.NoError(t, err)
	assert.Equal(t, template.ID, byName.ID)

	list, total, err := repo.List(ctx, ExporterTemplateFilter{Keyword: "custom"})
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, list, 1)

	got.Version = "1.2.3"
	got.DefaultPort = 9191
	require.NoError(t, repo.Update(ctx, got))
	reloaded, err := repo.Get(ctx, got.ID)
	require.NoError(t, err)
	assert.Equal(t, "1.2.3", reloaded.Version)
	assert.Equal(t, 9191, reloaded.DefaultPort)

	duplicate := newExporter("custom-exporter")
	err = repo.Create(ctx, duplicate)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)

	require.NoError(t, repo.SoftDelete(ctx, got.ID))
	_, err = repo.Get(ctx, got.ID)
	assertNotFound(t, err)
}

func TestMappingRepository(t *testing.T) {
	gormDB := openTestDB(t)
	exporters := NewExporterTemplateRepository(gormDB)
	mappings := NewMappingRepository(gormDB)
	ctx := context.Background()

	node := newExporter("node-exporter")
	require.NoError(t, exporters.Create(ctx, node))
	other := newExporter("other-exporter")
	require.NoError(t, exporters.Create(ctx, other))

	mapping := &domain.Mapping{
		MonitorType:        "host_linux",
		ExporterTemplateID: node.ID,
		IsDefault:          true,
		DefaultPort:        9100,
		MetricsPath:        "/metrics",
		Scheme:             domain.SchemeHTTP,
		ScrapeInterval:     "15s",
		ScrapeTimeout:      "10s",
	}
	require.NoError(t, mappings.Create(ctx, mapping))
	assert.NotEmpty(t, mapping.ID)

	hasDefault, err := mappings.HasDefault(ctx, "host_linux", "")
	require.NoError(t, err)
	assert.True(t, hasDefault)

	found, ok, err := mappings.FindByMonitorTypeAndExporter(ctx, "host_linux", node.ID)
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, mapping.ID, found.ID)

	second := &domain.Mapping{
		MonitorType:        "host_linux",
		ExporterTemplateID: other.ID,
		IsDefault:          true,
		MetricsPath:        "/metrics",
		Scheme:             domain.SchemeHTTP,
		ScrapeInterval:     "15s",
		ScrapeTimeout:      "10s",
	}
	err = mappings.Create(ctx, second)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict, "a monitor type may have only one default")

	count, err := mappings.CountByExporterTemplate(ctx, node.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	// label_template_id is now a real FK to m07_label_templates(id).
	require.NoError(t, gormDB.Exec(
		`INSERT INTO m07_label_templates(id,name,resource_category) VALUES ('lt-1','节点标签模板','host')`).Error)
	found.LabelTemplateID = "lt-1"
	require.NoError(t, mappings.Update(ctx, found))
	reloaded, err := mappings.Get(ctx, found.ID)
	require.NoError(t, err)
	assert.Equal(t, "lt-1", reloaded.LabelTemplateID)

	require.NoError(t, mappings.SoftDelete(ctx, mapping.ID))
	_, err = mappings.Get(ctx, mapping.ID)
	assertNotFound(t, err)
}

func TestJobRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewJobRepository(gormDB)
	ctx := context.Background()

	job := newJob("node-prod")
	require.NoError(t, repo.Create(ctx, job))
	assert.NotEmpty(t, job.ID)

	got, err := repo.Get(ctx, job.ID)
	require.NoError(t, err)
	assert.Equal(t, []string{"res-1", "res-2"}, got.SelectedInstanceIDs)
	require.Len(t, got.MappingOverrides, 1)
	assert.Equal(t, "scrape_interval", got.MappingOverrides[0].Field)

	list, total, err := repo.List(ctx, JobFilter{NetworkDomainID: "mc-demo", Keyword: "node"})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, list, 1)

	duplicate := newJob("node-prod")
	err = repo.Create(ctx, duplicate)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)

	// Zero-value updates must persist (Select("*") semantics).
	got.Enabled = false
	got.Sync = domain.SyncState{Status: domain.SyncSynced, Version: "v-1"}
	require.NoError(t, repo.Update(ctx, got))
	reloaded, err := repo.Get(ctx, got.ID)
	require.NoError(t, err)
	assert.False(t, reloaded.Enabled)
	assert.Equal(t, domain.SyncSynced, reloaded.Sync.Status)
	assert.Equal(t, "v-1", reloaded.Sync.Version)

	byLabel, err := repo.CountByLabelTemplate(ctx, "lt-1")
	require.NoError(t, err)
	assert.Equal(t, int64(0), byLabel)

	byDomain, err := repo.CountByNetworkDomain(ctx, "mc-demo")
	require.NoError(t, err)
	assert.Equal(t, int64(1), byDomain)

	require.NoError(t, repo.SoftDelete(ctx, got.ID))
	_, err = repo.Get(ctx, got.ID)
	assertNotFound(t, err)

	// A job bound to a missing domain is rejected by the FK.
	orphan := newJob("orphan")
	orphan.NetworkDomainID = "missing-domain"
	err = repo.Create(ctx, orphan)
	require.Error(t, err)
	assert.False(t, errors.As(err, &conflict))
}

func TestRuleRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewRuleRepository(gormDB)
	ctx := context.Background()

	rule := &domain.Rule{
		Name:        "host-down",
		ContentMode: domain.RuleYAMLPassthrough,
		RuleContent: "groups: []",
		Labels:      map[string]string{"severity": "critical"},
		Annotations: map[string]string{"summary": "host down"},
		Scope:       domain.ScopeCentral,
		Enabled:     true,
		DraftStatus: domain.DraftStatusReady,
		Sync:        domain.SyncState{Status: domain.SyncDraft},
	}
	require.NoError(t, repo.Create(ctx, rule))
	assert.NotEmpty(t, rule.ID)

	ready, err := repo.ListEnabledReady(ctx)
	require.NoError(t, err)
	require.Len(t, ready, 1)
	assert.Equal(t, map[string]string{"severity": "critical"}, ready[0].Labels)

	rule.Enabled = false
	rule.RuleContent = "groups:\n- name: host"
	require.NoError(t, repo.Update(ctx, rule))
	ready, err = repo.ListEnabledReady(ctx)
	require.NoError(t, err)
	assert.Empty(t, ready)

	reloaded, err := repo.Get(ctx, rule.ID)
	require.NoError(t, err)
	assert.False(t, reloaded.Enabled)
	assert.Equal(t, "groups:\n- name: host", reloaded.RuleContent)

	require.NoError(t, repo.SoftDelete(ctx, rule.ID))
	_, err = repo.Get(ctx, rule.ID)
	assertNotFound(t, err)
}

func TestMetricRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewMetricRepository(gormDB)
	ctx := context.Background()

	builtin := &domain.Metric{
		MetricName:   "node_cpu_usage",
		MetricType:   domain.MetricGauge,
		MonitorTypes: []domain.MetricAnchor{{MonitorType: "host_linux", SourceExporter: "node-exporter"}},
		Category:     "cpu",
		IsBuiltin:    true,
		Enabled:      true,
	}
	require.NoError(t, repo.Create(ctx, builtin))

	duplicate := &domain.Metric{MetricName: "node_cpu_usage", MetricType: domain.MetricGauge, IsBuiltin: true, Enabled: true}
	err := repo.Create(ctx, duplicate)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict, "built-in metric names are unique")

	// User metrics may share a name with a built-in one (different anchor).
	userMetric := &domain.Metric{MetricName: "node_cpu_usage", MetricType: domain.MetricGauge, Enabled: true}
	require.NoError(t, repo.Create(ctx, userMetric))

	list, total, err := repo.List(ctx, MetricFilter{Category: "cpu"})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total, "user metric has no category")
	require.Len(t, list, 1)

	userMetric.Enabled = false
	userMetric.Help = "custom"
	require.NoError(t, repo.Update(ctx, userMetric))
	reloaded, err := repo.Get(ctx, userMetric.ID)
	require.NoError(t, err)
	assert.False(t, reloaded.Enabled)
	assert.Equal(t, "custom", reloaded.Help)
	assert.False(t, reloaded.IsBuiltin, "is_builtin is not mutable through Update")

	require.NoError(t, repo.SoftDelete(ctx, userMetric.ID))
	_, err = repo.Get(ctx, userMetric.ID)
	assertNotFound(t, err)
}

func TestMetricRepositoryMonitorTypeAndResourceCategoryFilters(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewMetricRepository(gormDB)
	ctx := context.Background()

	metrics := []*domain.Metric{
		{
			MetricName:   "host_cpu_usage",
			MetricType:   domain.MetricGauge,
			MonitorTypes: []domain.MetricAnchor{{MonitorType: "host_linux", SourceExporter: "node-exporter"}},
			Enabled:      true,
		},
		{
			MetricName:   "windows_cpu_usage",
			MetricType:   domain.MetricGauge,
			MonitorTypes: []domain.MetricAnchor{{MonitorType: "host_windows", SourceExporter: "windows-exporter"}},
			Enabled:      true,
		},
		{
			MetricName:   "mysql_connections",
			MetricType:   domain.MetricGauge,
			MonitorTypes: []domain.MetricAnchor{{MonitorType: "mysql", SourceExporter: "mysqld-exporter"}},
			Enabled:      true,
		},
		{
			// Multi-anchor metric must match either of its monitor types and is
			// counted once even when several anchors fall in the same category.
			MetricName: "shared_requests_total",
			MetricType: domain.MetricCounter,
			MonitorTypes: []domain.MetricAnchor{
				{MonitorType: "host_linux", SourceExporter: "node-exporter"},
				{MonitorType: "application_http", SourceExporter: "app-exporter"},
			},
			Enabled: true,
		},
	}
	for _, metric := range metrics {
		require.NoError(t, repo.Create(ctx, metric))
	}

	cases := []struct {
		name   string
		filter MetricFilter
		total  int64
		names  []string
	}{
		{
			name:   "monitor type matches one anchor",
			filter: MetricFilter{MonitorType: "mysql"},
			total:  1,
			names:  []string{"mysql_connections"},
		},
		{
			name:   "monitor type matches multi-anchor metric once",
			filter: MetricFilter{MonitorType: "host_linux"},
			total:  2,
			names:  []string{"host_cpu_usage", "shared_requests_total"},
		},
		{
			name:   "resource category expands to host monitor types",
			filter: MetricFilter{ResourceCategory: domain.CategoryHost},
			total:  3,
			names:  []string{"host_cpu_usage", "shared_requests_total", "windows_cpu_usage"},
		},
		{
			name:   "resource category expands to database monitor types",
			filter: MetricFilter{ResourceCategory: domain.CategoryDatabase},
			total:  1,
			names:  []string{"mysql_connections"},
		},
		{
			name:   "monitor type and resource category combine with AND",
			filter: MetricFilter{MonitorType: "host_linux", ResourceCategory: domain.CategoryApplication},
			total:  1,
			names:  []string{"shared_requests_total"},
		},
		{
			name:   "mismatched monitor type and resource category",
			filter: MetricFilter{MonitorType: "mysql", ResourceCategory: domain.CategoryHost},
			total:  0,
		},
		{
			name:   "category without monitor types matches nothing",
			filter: MetricFilter{ResourceCategory: domain.CategoryInterfaceService},
			total:  0,
		},
		{
			name:   "unknown resource category matches nothing",
			filter: MetricFilter{ResourceCategory: "unknown"},
			total:  0,
		},
		{
			name:   "semantic category filter stays independent",
			filter: MetricFilter{ResourceCategory: domain.CategoryHost, MetricType: domain.MetricCounter},
			total:  1,
			names:  []string{"shared_requests_total"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			list, total, err := repo.List(ctx, tc.filter)
			require.NoError(t, err)
			assert.Equal(t, tc.total, total)
			names := make([]string, 0, len(list))
			for _, item := range list {
				names = append(names, item.MetricName)
			}
			if tc.total == 0 {
				assert.Empty(t, names)
				return
			}
			assert.ElementsMatch(t, tc.names, names)
		})
	}
}

func TestBusinessMetricRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewBusinessMetricRepository(gormDB)
	ctx := context.Background()

	metric := &domain.BusinessMetric{
		MetricID:       "biz.order.count",
		MetricName:     "order_count",
		MetricType:     domain.MetricCounter,
		BusinessDomain: "payment",
		Owner:          "sre",
		RegisterSource: domain.RegisterSourceSelf,
		Status:         domain.BusinessMetricPending,
	}
	require.NoError(t, repo.Create(ctx, metric))

	found, ok, err := repo.GetByName(ctx, "order_count")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, metric.ID, found.ID)

	duplicate := *metric
	duplicate.ID = ""
	err = repo.Create(ctx, &duplicate)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)

	metric.Status = domain.BusinessMetricInstrumented
	metric.ThresholdSuggestion = "> 1000"
	require.NoError(t, repo.Update(ctx, metric))
	reloaded, err := repo.Get(ctx, metric.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.BusinessMetricInstrumented, reloaded.Status)
	assert.Equal(t, "> 1000", reloaded.ThresholdSuggestion)

	require.NoError(t, repo.SoftDelete(ctx, metric.ID))
	_, err = repo.Get(ctx, metric.ID)
	assertNotFound(t, err)
}

func TestInstallationRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewInstallationRepository(gormDB)
	ctx := context.Background()

	note := &domain.Installation{
		ResourceID:  "res-1",
		ScrapeJobID: "job-1",
		Status:      domain.InstallationConfirmed,
		ActualPort:  9100,
		ConfirmedBy: "ops",
	}
	require.NoError(t, repo.Upsert(ctx, note))
	assert.NotEmpty(t, note.ID)

	got, err := repo.Get(ctx, "res-1", "job-1")
	require.NoError(t, err)
	assert.Equal(t, 9100, got.ActualPort)

	note.Notes = "upgraded"
	note.ActualPort = 9200
	require.NoError(t, repo.Upsert(ctx, note))
	reloaded, err := repo.Get(ctx, "res-1", "job-1")
	require.NoError(t, err)
	assert.Equal(t, note.ID, reloaded.ID)
	assert.Equal(t, 9200, reloaded.ActualPort)
	assert.Equal(t, "upgraded", reloaded.Notes)

	all, err := repo.ListByJob(ctx, "job-1")
	require.NoError(t, err)
	require.Len(t, all, 1)

	require.NoError(t, repo.Delete(ctx, "res-1", "job-1"))
	_, err = repo.Get(ctx, "res-1", "job-1")
	assertNotFound(t, err)
}

func TestProbeModuleRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewProbeModuleRepository(gormDB)
	ctx := context.Background()

	module := &domain.ProbeModule{Name: "http_2xx", Content: "http_2xx: {}", IsBuiltin: true, Enabled: true}
	require.NoError(t, repo.Create(ctx, module))

	byName, err := repo.GetByName(ctx, "http_2xx")
	require.NoError(t, err)
	assert.Equal(t, module.ID, byName.ID)

	duplicate := &domain.ProbeModule{Name: "http_2xx", Content: "http_2xx: {}"}
	err = repo.Create(ctx, duplicate)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)

	module.Enabled = false
	require.NoError(t, repo.Update(ctx, module))
	reloaded, err := repo.Get(ctx, module.ID)
	require.NoError(t, err)
	assert.False(t, reloaded.Enabled)
	assert.True(t, reloaded.IsBuiltin, "is_builtin is not mutable through Update")

	require.NoError(t, repo.SoftDelete(ctx, module.ID))
	_, err = repo.Get(ctx, module.ID)
	assertNotFound(t, err)
}

// 00012: job_name 唯一性由全局收敛为「同域唯一」——同组跨域复用同一 job_name 合法，
// 同域重名仍被拒。这是「一张意图 + N 条子 Job」方案能落地的数据前提。
func TestJobNameUniquePerDomain(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewJobRepository(gormDB)
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		VALUES ('mc-other','第二采集域','edge','platform_admin','enabled')`).Error)

	inDemo := newJob("mysql")
	require.NoError(t, repo.Create(ctx, inDemo))

	inOther := newJob("mysql")
	inOther.NetworkDomainID = "mc-other"
	require.NoError(t, repo.Create(ctx, inOther), "same job_name in another domain must be allowed")

	duplicate := newJob("mysql")
	var conflict *domain.ConflictError
	require.ErrorAs(t, repo.Create(ctx, duplicate), &conflict, "same job_name in the same domain must conflict")

	// 删除后同名可重建（部分唯一索引用 deleted_at IS NULL 过滤）
	require.NoError(t, repo.SoftDelete(ctx, inDemo.ID))
	require.NoError(t, repo.Create(ctx, newJob("mysql")))
}

// 00012: 子 Job 的 job_group_id 必须可往返，且旧数据（NULL）读出来是空串。
func TestJobGroupIDRoundTrip(t *testing.T) {
	gormDB := openTestDB(t)
	groups := NewJobGroupRepository(gormDB)
	jobs := NewJobRepository(gormDB)
	ctx := context.Background()

	group := &domain.JobGroup{
		Name:             "主机基础采集",
		JobType:          domain.JobTypeStandard,
		ResourceCategory: domain.CategoryHost,
		MonitorType:      "host_linux",
		ScrapeInterval:   "15s",
		ScrapeTimeout:    "10s",
		MetricsPath:      "/metrics",
		Scheme:           domain.SchemeHTTP,
		AuthType:         domain.AuthNone,
		MappingOverrides: []domain.MappingOverride{{Field: "scrape_interval", Value: "15s"}},
		Status:           domain.JobGroupStatusEnabled,
		CreatedBy:        "admin",
	}
	require.NoError(t, groups.Create(ctx, group))
	assert.NotEmpty(t, group.ID)

	job := newJob("host-base")
	job.JobGroupID = group.ID
	require.NoError(t, jobs.Create(ctx, job))

	got, err := jobs.Get(ctx, job.ID)
	require.NoError(t, err)
	assert.Equal(t, group.ID, got.JobGroupID)

	legacy := newJob("legacy-job")
	require.NoError(t, jobs.Create(ctx, legacy))
	gotLegacy, err := jobs.Get(ctx, legacy.ID)
	require.NoError(t, err)
	assert.Empty(t, gotLegacy.JobGroupID)
}

func TestJobGroupRepository(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewJobGroupRepository(gormDB)
	ctx := context.Background()

	group := &domain.JobGroup{
		Name:             "数据库基础采集",
		JobType:          domain.JobTypeStandard,
		ResourceCategory: domain.CategoryDatabase,
		MonitorType:      "mysql",
		ScrapeInterval:   "30s",
		ScrapeTimeout:    "10s",
		MetricsPath:      "/metrics",
		Scheme:           domain.SchemeHTTP,
		AuthType:         domain.AuthNone,
		Status:           domain.JobGroupStatusEnabled,
		CreatedBy:        "admin",
	}
	require.NoError(t, repo.Create(ctx, group))

	got, err := repo.Get(ctx, group.ID)
	require.NoError(t, err)
	assert.Equal(t, "数据库基础采集", got.Name)
	assert.Equal(t, domain.JobGroupStatusEnabled, got.Status)
	assert.Equal(t, "30s", got.ScrapeInterval)

	count, err := repo.CountByName(ctx, "数据库基础采集")
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	var conflict *domain.ConflictError
	require.ErrorAs(t, repo.Create(ctx, &domain.JobGroup{
		Name: "数据库基础采集", ResourceCategory: domain.CategoryDatabase, Status: domain.JobGroupStatusEnabled,
	}), &conflict, "group name is globally unique")

	list, total, err := repo.List(ctx, JobGroupFilter{Keyword: "数据库"})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, list, 1)

	got.Status = domain.JobGroupStatusDisabled
	got.ScrapeInterval = "60s"
	require.NoError(t, repo.Update(ctx, got))
	reloaded, err := repo.Get(ctx, got.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.JobGroupStatusDisabled, reloaded.Status)
	assert.Equal(t, "60s", reloaded.ScrapeInterval)

	require.NoError(t, repo.SoftDelete(ctx, got.ID))
	_, err = repo.Get(ctx, got.ID)
	assertNotFound(t, err)
	// 软删后同名可重新登记
	require.NoError(t, repo.Create(ctx, &domain.JobGroup{
		Name: "数据库基础采集", ResourceCategory: domain.CategoryDatabase, Status: domain.JobGroupStatusEnabled,
	}))
}
