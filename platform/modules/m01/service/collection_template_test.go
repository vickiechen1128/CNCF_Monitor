package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

func newUserTemplate(code, exporterID string) *domain.CollectionTemplate {
	return &domain.CollectionTemplate{
		Code:               code,
		Name:               "DPU 主机采集",
		ResourceCategory:   domain.CategoryHost,
		ExporterTemplateID: exporterID,
		DefaultPort:        9100,
		MetricsPath:        "/metrics",
		Scheme:             domain.SchemeHTTP,
		ScrapeInterval:     "15s",
		ScrapeTimeout:      "10s",
		DefaultSelector: domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
			{Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}},
		}},
		Enabled: true,
	}
}

// A template created through the service is immediately usable by jobs: the
// catalogue is data, so no code change or restart is involved (FR-21 / NFR-11).
func TestCreateCollectionTemplateIsImmediatelyUsable(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template.db")
	exporter, _ := seedNodeTemplate(t, gormDB)
	svc := newTemplateService(gormDB)
	ctx := context.Background()

	created, err := svc.Create(ctx, newUserTemplate("host_dpu", exporter.ID))
	require.NoError(t, err)
	assert.Equal(t, "host_dpu", created.Template.Code)
	assert.False(t, created.Template.IsBuiltin, "user-created templates stay deletable")
	assert.Equal(t, "node-exporter", created.ExporterTemplateName)
	assert.Equal(t, int64(0), created.JobCount)

	// Catalog resolves the recipe and its exporter for job validation.
	template, resolvedExporter, err := svc.Catalog(ctx, "host_dpu")
	require.NoError(t, err)
	assert.Equal(t, "host_dpu", template.Code)
	assert.Equal(t, exporter.ID, resolvedExporter.ID)

	// A template keeps only the wizard prefill; the scope lives on the job.
	require.Len(t, template.DefaultSelector.Filters, 1)
	assert.Equal(t, "has_gpu", template.DefaultSelector.Filters[0].Field)

	list, total, err := svc.List(ctx, repository.TemplateFilter{ResourceCategory: "host"})
	require.NoError(t, err)
	assert.Equal(t, int64(2), total, "seeded host_linux + the new template")
	assert.Len(t, list, 2)
}

func TestCreateCollectionTemplateValidation(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template_validation.db")
	exporter, _ := seedNodeTemplate(t, gormDB)
	svc := newTemplateService(gormDB)
	ctx := context.Background()

	cases := []struct {
		name     string
		mutate   func(*domain.CollectionTemplate)
		contains string
	}{
		{"missing code", func(tpl *domain.CollectionTemplate) { tpl.Code = "" }, "code"},
		{"missing name", func(tpl *domain.CollectionTemplate) { tpl.Name = "" }, "name"},
		{"missing exporter", func(tpl *domain.CollectionTemplate) { tpl.ExporterTemplateID = "" }, "exporter_template_id"},
		{"unknown exporter", func(tpl *domain.CollectionTemplate) { tpl.ExporterTemplateID = "missing" }, "not found"},
		{"illegal selector field", func(tpl *domain.CollectionTemplate) {
			tpl.DefaultSelector = domain.Selector{Filters: []domain.ScopeFilter{
				{Field: "1=1 OR r.status", Operator: domain.RuleOpEq, Values: []string{"online"}},
			}}
		}, "unknown filter field"},
		{"selector field from another category", func(tpl *domain.CollectionTemplate) {
			tpl.ResourceCategory = domain.CategoryDatabase
		}, "does not apply to resource category"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := newUserTemplate("host_bad", exporter.ID)
			tc.mutate(input)
			_, err := svc.Create(ctx, input)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tc.contains)
		})
	}

	// A duplicate code is a contract conflict.
	_, err := svc.Create(ctx, newUserTemplate("host_linux", exporter.ID))
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)

	// Label templates must exist and belong to the same resource category.
	require.NoError(t, gormDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-host','host-default','host')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-db','db-default','database')`).Error)

	withLabel := newUserTemplate("host_with_label", exporter.ID)
	withLabel.LabelTemplateID = "lt-host"
	created, err := svc.Create(ctx, withLabel)
	require.NoError(t, err)
	assert.Equal(t, "lt-host", created.Template.LabelTemplateID)
	assert.Equal(t, "host-default", created.LabelTemplateName)

	mismatch := newUserTemplate("host_bad_label", exporter.ID)
	mismatch.LabelTemplateID = "lt-db"
	_, err = svc.Create(ctx, mismatch)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not match")

	missing := newUserTemplate("host_missing_label", exporter.ID)
	missing.LabelTemplateID = "lt-missing"
	_, err = svc.Create(ctx, missing)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestUpdateCollectionTemplate(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template_update.db")
	exporter, _ := seedNodeTemplate(t, gormDB)
	svc := newTemplateService(gormDB)
	ctx := context.Background()

	_, err := svc.Create(ctx, newUserTemplate("host_dpu", exporter.ID))
	require.NoError(t, err)

	next := newUserTemplate("host_dpu", exporter.ID)
	next.Code = "ignored-on-update"
	next.Name = "DPU 主机采集 v2"
	next.DefaultPort = 9110
	next.Enabled = false
	next.DefaultSelector = domain.Selector{Logic: domain.RuleLogicAny, Filters: []domain.ScopeFilter{
		{Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}},
		{Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}},
	}}

	updated, err := svc.Update(ctx, "host_dpu", next)
	require.NoError(t, err)
	assert.Equal(t, "host_dpu", updated.Template.Code, "the code is immutable")
	assert.Equal(t, "DPU 主机采集 v2", updated.Template.Name)
	assert.Equal(t, 9110, updated.Template.DefaultPort)
	assert.False(t, updated.Template.Enabled)
	assert.Len(t, updated.Template.DefaultSelector.Filters, 2)

	_, err = svc.Update(ctx, "does_not_exist", next)
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)
}

// Built-in templates are editable only by a platform administrator and can never
// be deleted (FR-21 / FR-24 / FR-29).
func TestBuiltinCollectionTemplateWritesRequirePlatformAdmin(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template_admin.db")
	exporter, _ := seedNodeTemplate(t, gormDB)
	svc := newTemplateService(gormDB)
	ctx := context.Background()

	operator := WithActor(ctx, Actor{TenantID: "tenant-a"})
	admin := WithActor(ctx, Actor{TenantID: "platform_admin", IsPlatformAdmin: true})

	// Reads are open to every authenticated user.
	_, err := svc.Get(operator, "host_linux")
	require.NoError(t, err)

	edit := newUserTemplate("host_linux", exporter.ID)
	edit.Name = "改名"
	_, err = svc.Update(operator, "host_linux", edit)
	var forbidden *domain.ForbiddenError
	require.ErrorAs(t, err, &forbidden)
	assert.Contains(t, err.Error(), "platform administrator")

	updated, err := svc.Update(admin, "host_linux", edit)
	require.NoError(t, err)
	assert.Equal(t, "改名", updated.Template.Name)
	assert.True(t, updated.Template.IsBuiltin, "the built-in flag is not mutable through Update")

	// Deletion is forbidden for everyone, administrators included.
	require.Error(t, svc.Delete(admin, "host_linux"))
	_, err = svc.Get(ctx, "host_linux")
	require.NoError(t, err, "a refused delete keeps the row")

	// Non-builtin writes need no administrator.
	_, err = svc.Create(operator, newUserTemplate("host_dpu", exporter.ID))
	require.NoError(t, err)
	require.NoError(t, svc.Delete(operator, "host_dpu"))
}

func TestDeleteCollectionTemplateGuards(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template_delete.db")
	exporter, _ := seedNodeTemplate(t, gormDB)
	svc := newTemplateService(gormDB)
	ctx := context.Background()

	_, err := svc.Create(ctx, newUserTemplate("host_dpu", exporter.ID))
	require.NoError(t, err)

	// A live job reference blocks the delete.
	require.NoError(t, gormDB.Exec(`INSERT INTO tenants(id,name,status)
		VALUES ('platform_admin','平台默认租户','active')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`).Error)
	jobRepo := repository.NewJobRepository(gormDB)
	require.NoError(t, jobRepo.Create(ctx, &domain.Job{
		JobName: "dpu-prod", JobType: domain.JobTypeStandard,
		ResourceCategory: domain.CategoryHost, TemplateCode: "host_dpu",
		NetworkDomainID: "mc-demo", InstanceSelectionMode: domain.SelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics",
		Scheme: domain.SchemeHTTP, AuthType: domain.AuthNone,
		DraftStatus: domain.DraftStatusReady, Enabled: true,
		Sync: domain.SyncState{Status: domain.SyncPending},
	}))

	err = svc.Delete(ctx, "host_dpu")
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)
	assert.Contains(t, err.Error(), "still referenced")

	// The impact preview names the same reference.
	impact, template, err := svc.Impact(ctx, "host_dpu")
	require.NoError(t, err)
	assert.Equal(t, "host_dpu", template.Code)
	assert.Equal(t, int64(1), impact.Jobs)
	assert.Equal(t, int64(0), impact.MetricAnchors)
	assert.Equal(t, int64(1), impact.Total())

	// Metric anchors count as references too.
	require.NoError(t, repository.NewMetricRepository(gormDB).Create(ctx, &domain.Metric{
		MetricName:          "dpu_utilization",
		MetricType:          domain.MetricGauge,
		CollectionTemplates: []domain.MetricAnchor{{TemplateCode: "host_dpu"}},
		Enabled:             true,
	}))
	impact, _, err = svc.Impact(ctx, "host_dpu")
	require.NoError(t, err)
	assert.Equal(t, int64(1), impact.MetricAnchors)

	// Unknown template ids surface a not-found error.
	_, _, err = svc.Impact(ctx, "does_not_exist")
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)
}

// EnsureBuiltins is the create-only boot seed: it fills the gaps and never
// overwrites a user edit (NFR-11 idempotent seed).
func TestEnsureBuiltinsIsCreateOnly(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template_bootstrap.db")
	exporters := repository.NewExporterTemplateRepository(gormDB)
	templates := repository.NewCollectionTemplateRepository(gormDB)
	svc := NewCollectionTemplateService(templates, exporters, nil)
	ctx := context.Background()

	// A pre-existing, user-disabled host_linux row must survive the seed.
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_collection_templates(
		code,name,resource_category,enabled)
		VALUES ('host_linux','手工维护的 Linux 采集','host',FALSE)`).Error)

	require.NoError(t, svc.EnsureBuiltins(ctx))

	kept, err := svc.Get(ctx, "host_linux")
	require.NoError(t, err)
	assert.Equal(t, "手工维护的 Linux 采集", kept.Template.Name)
	assert.False(t, kept.Template.Enabled)

	_, total, err := svc.List(ctx, repository.TemplateFilter{})
	require.NoError(t, err)
	assert.Equal(t, int64(len(domain.BuiltinCollectionTemplates())), total)

	// Running it again changes nothing.
	require.NoError(t, svc.EnsureBuiltins(ctx))
	_, total, err = svc.List(ctx, repository.TemplateFilter{})
	require.NoError(t, err)
	assert.Equal(t, int64(len(domain.BuiltinCollectionTemplates())), total)
}

// A template without a bound exporter cannot drive a job, and Catalog says so.
func TestCatalogRejectsUnboundTemplate(t *testing.T) {
	gormDB := newServiceDB(t, "m01_template_unbound.db")
	svc := newTemplateService(gormDB)
	ctx := context.Background()

	require.NoError(t, svc.EnsureBuiltins(ctx))

	_, _, err := svc.Catalog(ctx, "host_npu")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no exporter bound")

	_, _, err = svc.Catalog(ctx, "does_not_exist")
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)
}
