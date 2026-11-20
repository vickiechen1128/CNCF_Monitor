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
		JobName:          name,
		JobType:          domain.JobTypeStandard,
		ResourceCategory: domain.CategoryHost,
		TemplateCode:     "host_linux",
		Selector: domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
			{Field: "os_family", Operator: domain.RuleOpEq, Values: []string{"linux"}},
		}},
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
	require.NoError(t, repo.Create(ctx, template))
	assert.NotEmpty(t, template.ID)
	assert.False(t, template.CreatedAt.IsZero())

	got, err := repo.Get(ctx, template.ID)
	require.NoError(t, err)
	assert.Equal(t, "custom-exporter", got.Name)
	assert.Equal(t, domain.ExporterThirdParty, got.Source)

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

func newCollectionTemplate(code, exporterID string) *domain.CollectionTemplate {
	return &domain.CollectionTemplate{
		Code:               code,
		Name:               "Linux 主机采集",
		ResourceCategory:   domain.CategoryHost,
		ExporterTemplateID: exporterID,
		DefaultPort:        9100,
		MetricsPath:        "/metrics",
		Scheme:             domain.SchemeHTTP,
		ScrapeInterval:     "15s",
		ScrapeTimeout:      "10s",
		DefaultSelector: domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
			{Field: "os_family", Operator: domain.RuleOpEq, Values: []string{"linux"}},
		}},
		Description: "测试模板",
		SortOrder:   10,
		Enabled:     true,
		IsBuiltin:   true,
	}
}

// The retired mapping repository persisted "monitor type → exporter + default
// parameters"; a collection template now carries the same recipe plus the
// wizard prefill selector (SRS Module_01 v1.5 FR-21 / FR-24).
func TestCollectionTemplateRepository(t *testing.T) {
	gormDB := openTestDB(t)
	exporters := NewExporterTemplateRepository(gormDB)
	templates := NewCollectionTemplateRepository(gormDB)
	ctx := context.Background()

	node := newExporter("node-exporter")
	require.NoError(t, exporters.Create(ctx, node))

	template := newCollectionTemplate("host_linux", node.ID)
	require.NoError(t, templates.Create(ctx, template))
	assert.False(t, template.CreatedAt.IsZero())

	got, err := templates.Get(ctx, "host_linux")
	require.NoError(t, err)
	assert.Equal(t, node.ID, got.ExporterTemplateID)
	assert.Equal(t, 9100, got.DefaultPort)
	require.Len(t, got.DefaultSelector.Filters, 1)
	assert.Equal(t, "os_family", got.DefaultSelector.Filters[0].Field)
	assert.Equal(t, []string{"linux"}, got.DefaultSelector.Filters[0].Values)
	assert.Equal(t, domain.RuleLogicAll, got.DefaultSelector.Logic)

	found, ok, err := templates.Find(ctx, "host_linux")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "host_linux", found.Code)

	missing, ok, err := templates.Find(ctx, "nope")
	require.NoError(t, err)
	assert.False(t, ok)
	assert.Nil(t, missing)
	_, err = templates.Get(ctx, "nope")
	assertNotFound(t, err)

	// Duplicate code is a contract-level conflict.
	require.Error(t, templates.Create(ctx, newCollectionTemplate("host_linux", node.ID)))

	windows := newCollectionTemplate("host_windows", node.ID)
	windows.Name = "Windows 主机采集"
	windows.DefaultPort = 9182
	require.NoError(t, templates.Create(ctx, windows))

	mysql := newCollectionTemplate("mysql", node.ID)
	mysql.Name = "MySQL 采集"
	mysql.ResourceCategory = domain.CategoryDatabase
	mysql.Enabled = false
	require.NoError(t, templates.Create(ctx, mysql))

	list, total, err := templates.List(ctx, TemplateFilter{ResourceCategory: "host"})
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, list, 2)

	disabled := false
	_, total, err = templates.List(ctx, TemplateFilter{Enabled: &disabled})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total, "disabled templates are filterable, not hidden")

	_, total, err = templates.List(ctx, TemplateFilter{Keyword: "mysql"})
	require.NoError(t, err)
	assert.Equal(t, int64(1), total, "keyword matches code or name")

	page, total, err := templates.List(ctx, TemplateFilter{Page: 1, PageSize: 1})
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)
	assert.Len(t, page, 1)

	// Update replaces mutable fields; the code stays immutable.
	got.Name = "Linux 主机采集 v2"
	got.DefaultPort = 9101
	got.Enabled = false
	require.NoError(t, templates.Update(ctx, got))
	reloaded, err := templates.Get(ctx, "host_linux")
	require.NoError(t, err)
	assert.Equal(t, "Linux 主机采集 v2", reloaded.Name)
	assert.Equal(t, 9101, reloaded.DefaultPort)
	assert.False(t, reloaded.Enabled)

	assertNotFound(t, templates.Update(ctx, newCollectionTemplate("does_not_exist", node.ID)))

	// label_template_id is a real FK to m07_label_templates(id).
	require.NoError(t, gormDB.Exec(
		`INSERT INTO m07_label_templates(id,name,resource_category) VALUES ('lt-1','节点标签模板','host')`).Error)
	reloaded.LabelTemplateID = "lt-1"
	require.NoError(t, templates.Update(ctx, reloaded))
	withLabel, err := templates.Get(ctx, "host_linux")
	require.NoError(t, err)
	assert.Equal(t, "lt-1", withLabel.LabelTemplateID)

	// Reference counters back the exporter/label guards and the delete pre-flight.
	byExporter, err := templates.CountByExporterTemplate(ctx, node.ID)
	require.NoError(t, err)
	assert.Equal(t, int64(3), byExporter)

	byLabel, err := templates.CountByLabelTemplate(ctx, "lt-1")
	require.NoError(t, err)
	assert.Equal(t, int64(1), byLabel)
	emptyLabel, err := templates.CountByLabelTemplate(ctx, "")
	require.NoError(t, err)
	assert.Equal(t, int64(0), emptyLabel)

	jobs := NewJobRepository(gormDB)
	require.NoError(t, jobs.Create(ctx, newJob("node-prod")))

	metrics := NewMetricRepository(gormDB)
	require.NoError(t, metrics.Create(ctx, &domain.Metric{
		MetricName:          "node_cpu_usage",
		MetricType:          domain.MetricGauge,
		CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "host_linux", SourceExporter: "node-exporter"}},
		Enabled:             true,
	}))

	counts, err := templates.CountReferences(ctx, "host_linux")
	require.NoError(t, err)
	assert.Equal(t, int64(1), counts.Jobs)
	assert.Equal(t, int64(1), counts.MetricAnchors)
	assert.Equal(t, int64(2), counts.Total())

	unreferenced, err := templates.CountReferences(ctx, "host_windows")
	require.NoError(t, err)
	assert.Equal(t, int64(0), unreferenced.Total(), "a quoted LIKE must not match a prefix")

	require.NoError(t, templates.SoftDelete(ctx, "mysql"))
	_, err = templates.Get(ctx, "mysql")
	assertNotFound(t, err)
	assertNotFound(t, templates.SoftDelete(ctx, "mysql"))
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
		MetricName:          "node_cpu_usage",
		MetricType:          domain.MetricGauge,
		CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "host_linux", SourceExporter: "node-exporter"}},
		Category:            "cpu",
		IsBuiltin:           true,
		Enabled:             true,
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

// Anchors are (metric, collection template) pairs: the same metric may serve
// several recipes, and a template filter must match it exactly once.
func TestMetricRepositoryTemplateAnchorFilters(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewMetricRepository(gormDB)
	ctx := context.Background()

	metrics := []*domain.Metric{
		{
			MetricName:          "host_cpu_usage",
			MetricType:          domain.MetricGauge,
			CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "host_linux", SourceExporter: "node-exporter"}},
			Enabled:             true,
		},
		{
			MetricName:          "windows_cpu_usage",
			MetricType:          domain.MetricGauge,
			CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "host_windows", SourceExporter: "windows-exporter"}},
			Enabled:             true,
		},
		{
			MetricName:          "mysql_connections",
			MetricType:          domain.MetricGauge,
			CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "mysql", SourceExporter: "mysqld-exporter"}},
			Enabled:             true,
		},
		{
			// Multi-anchor metric must match either template and is counted once
			// even when both anchors are hit by the same filter.
			MetricName: "shared_requests_total",
			MetricType: domain.MetricCounter,
			CollectionTemplates: []domain.MetricAnchor{
				{TemplateCode: "host_linux", SourceExporter: "node-exporter"},
				{TemplateCode: "host_linux", SourceExporter: "custom-exporter"},
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
			name:   "template code matches one anchor",
			filter: MetricFilter{TemplateCode: "mysql"},
			total:  1,
			names:  []string{"mysql_connections"},
		},
		{
			name:   "template code matches multi-anchor metric once",
			filter: MetricFilter{TemplateCode: "host_linux"},
			total:  2,
			names:  []string{"host_cpu_usage", "shared_requests_total"},
		},
		{
			name:   "unknown template code matches nothing",
			filter: MetricFilter{TemplateCode: "does_not_exist"},
			total:  0,
		},
		{
			name:   "template code and metric type combine with AND",
			filter: MetricFilter{TemplateCode: "host_linux", MetricType: domain.MetricCounter},
			total:  1,
			names:  []string{"shared_requests_total"},
		},
		{
			name:   "semantic category filter stays independent",
			filter: MetricFilter{TemplateCode: "host_linux", Category: "custom"},
			total:  0,
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

// (metric_name, template_code) uniqueness backs the 409 on user re-registration.
func TestMetricRepositoryAnchorConflict(t *testing.T) {
	gormDB := openTestDB(t)
	repo := NewMetricRepository(gormDB)
	ctx := context.Background()

	require.NoError(t, repo.Create(ctx, &domain.Metric{
		MetricName:          "shared_total",
		MetricType:          domain.MetricCounter,
		CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "host_linux"}},
		Enabled:             true,
	}))

	conflict, err := repo.HasAnchorConflict(ctx, "shared_total", []string{"host_linux"}, "")
	require.NoError(t, err)
	assert.True(t, conflict, "same name under the same template conflicts")

	conflict, err = repo.HasAnchorConflict(ctx, "shared_total", []string{"mysql"}, "")
	require.NoError(t, err)
	assert.False(t, conflict, "the same name under another template is allowed")

	conflict, err = repo.HasAnchorConflict(ctx, "shared_total", nil, "")
	require.NoError(t, err)
	assert.False(t, conflict, "no anchor means no conflict")

	var firstID string
	require.NoError(t, gormDB.Table("m01_metric_library").Select("id").Where("metric_name = ?", "shared_total").Scan(&firstID).Error)
	conflict, err = repo.HasAnchorConflict(ctx, "shared_total", []string{"host_linux"}, firstID)
	require.NoError(t, err)
	assert.False(t, conflict, "the row itself is excluded from the check")
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
		TemplateCode:     "host_linux",
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
		TemplateCode:     "mysql",
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
