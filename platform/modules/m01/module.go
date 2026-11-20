// Package m01 is the Module 01 v3 composition root.
//
// M01 owns monitoring strategies: collection templates, exporter templates,
// scrape jobs, monitoring rules and metric catalogues. It never
// renders Prometheus configuration, writes M09 snapshots or triggers reloads;
// M09 pulls the source data and reports sync results back (D-2).
package m01

import (
	"context"
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// Repositories groups the M01 persistence adapters. Services are wired from
// this struct by the module composition root.
type Repositories struct {
	Exporters       repository.ExporterTemplateRepository
	Templates       repository.CollectionTemplateRepository
	Jobs            repository.JobRepository
	Rules           repository.RuleRepository
	Metrics         repository.MetricRepository
	BusinessMetrics repository.BusinessMetricRepository
	Installations   repository.InstallationRepository
	ProbeModules    repository.ProbeModuleRepository
	// JobGroups persists monitoring intents (SRS JG v1.0).
	JobGroups repository.JobGroupRepository
}

// Options carries M01 background-loop tuning.
type Options struct {
	// ReconcileInterval is the D40 pull interval (default 60s).
	ReconcileInterval time.Duration
}

// Module wires M01 v3 repositories, services and handlers.
type Module struct {
	repos          Repositories
	exporters      *handler.ExporterTemplateHandler
	templates      *handler.CollectionTemplateHandler
	jobs           *handler.JobHandler
	rules          *handler.RuleHandler
	metrics        *handler.MetricHandler
	business       *handler.BusinessMetricHandler
	probes         *handler.ProbeModuleHandler
	jobGroups      *service.JobGroupService
	jobGroupAPI    *handler.JobGroupHandler
	templateSvc    *service.CollectionTemplateService
	labelTemplates service.LabelTemplateResolver
	labelUsage     *references.LabelTemplateUsageChecker
	syncSink       *references.SyncSink
	reconcile      *service.ReconcileService
}

// NewModule constructs the M01 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m01: database is required")
	}
	repos := Repositories{
		Exporters:       repository.NewExporterTemplateRepository(db),
		Templates:       repository.NewCollectionTemplateRepository(db),
		Jobs:            repository.NewJobRepository(db),
		Rules:           repository.NewRuleRepository(db),
		Metrics:         repository.NewMetricRepository(db),
		BusinessMetrics: repository.NewBusinessMetricRepository(db),
		Installations:   repository.NewInstallationRepository(db),
		ProbeModules:    repository.NewProbeModuleRepository(db),
		JobGroups:       repository.NewJobGroupRepository(db),
	}
	// D-3 resolved: M07 now owns m07_label_templates; M01 reads it read-only.
	labelReader := references.NewLabelTemplateReader(db)
	labelUsage := references.NewLabelTemplateUsageChecker(db)
	syncSink := references.NewSyncSink(db)
	// One M07 resource reader is shared by candidates, job groups and the
	// reconcile loop.
	resourceReader := references.NewResourceReader(db)
	templateSvc := service.NewCollectionTemplateService(repos.Templates, repos.Exporters, labelReader)
	exporterSvc := service.NewExporterTemplateService(repos.Exporters, repos.Templates)
	jobSvc := service.NewJobService(
		repos.Jobs, repos.Exporters, templateSvc, repos.ProbeModules, repos.Installations,
		resourceReader, references.NewDomainReader(db), labelReader,
	)
	// 选择器字段字典校验：内置字段来自 domain，自定义字段来自 M07。
	jobSvc.SetSelectorValidator(resourceReader)
	// 任务组名解析：Job 列表需要暴露 job_group_id / job_group_name（合并任务列表的前置）
	jobSvc.SetJobGroupResolver(repos.JobGroups)
	ruleSvc := service.NewRuleService(repos.Rules, repos.Jobs, repos.Exporters, templateSvc, service.NewPromtoolChecker())
	metricSvc := service.NewMetricService(repos.Metrics)
	businessSvc := service.NewBusinessMetricService(repos.BusinessMetrics)
	probeSvc := service.NewProbeModuleService(repos.ProbeModules, repos.Jobs)
	jobGroupSvc := service.NewJobGroupService(
		repos.JobGroups, jobSvc, resourceReader, references.NewDomainReader(db),
	)
	reconcileSvc := service.NewReconcileService(
		repos.Jobs, resourceReader, references.NewDomainReader(db), opts.ReconcileInterval,
	)

	return &Module{
		repos:          repos,
		exporters:      handler.NewExporterTemplateHandler(exporterSvc),
		templates:      handler.NewCollectionTemplateHandler(templateSvc, references.NewCustomFieldReader(db)),
		jobs:           handler.NewJobHandler(jobSvc),
		rules:          handler.NewRuleHandler(ruleSvc),
		metrics:        handler.NewMetricHandler(metricSvc),
		business:       handler.NewBusinessMetricHandler(businessSvc),
		probes:         handler.NewProbeModuleHandler(probeSvc),
		jobGroups:      jobGroupSvc,
		jobGroupAPI:    handler.NewJobGroupHandler(jobGroupSvc),
		templateSvc:    templateSvc,
		labelTemplates: labelReader,
		labelUsage:     labelUsage,
		syncSink:       syncSink,
		reconcile:      reconcileSvc,
	}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m01" }

// RegisterRoutes mounts M01 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.exporters, m.templates, m.jobs, m.rules, m.metrics, m.business, m.probes, m.jobGroupAPI)
	return nil
}

// Repositories exposes the persistence adapters for later services and tests.
func (m *Module) Repositories() Repositories { return m.repos }

// CollectionTemplateService exposes the collection template use cases.
func (m *Module) CollectionTemplateService() *service.CollectionTemplateService { return m.templateSvc }

// JobGroupService exposes the job-group use cases (HTTP wiring lands with the
// job-group handler; the service is already wired for tests and callers).
func (m *Module) JobGroupService() *service.JobGroupService { return m.jobGroups }

// ReconcileNow runs one M07-resource reconciliation pass. M07 change
// notifications use it to reclaim stale selected_instance_ids before M09
// regenerates the affected domain.
func (m *Module) ReconcileNow(ctx context.Context) error {
	if m.reconcile == nil {
		return nil
	}
	_, err := m.reconcile.ReconcileOnce(ctx)
	return err
}

// LabelTemplateResolver exposes the read-only label template port for job
// creation later (B3).
func (m *Module) LabelTemplateResolver() service.LabelTemplateResolver { return m.labelTemplates }

// LabelTemplateUsageChecker exposes the reference counter M07 injects to guard
// label template deletion.
func (m *Module) LabelTemplateUsageChecker() *references.LabelTemplateUsageChecker {
	return m.labelUsage
}

// SyncResultSink exposes the M09 writeback port. M09 calls it after generating
// a domain snapshot so jobs can move from pending to synced/failed.
func (m *Module) SyncResultSink() *references.SyncSink { return m.syncSink }

// Bootstrap seeds the built-in collection templates.
//
// It is deliberately separate from NewModule: construction stays free of I/O so
// wiring tests can build the module with a placeholder handle. The seed is
// create-only, so user edits and disabled templates survive restarts (FR-21).
func (m *Module) Bootstrap(ctx context.Context) error {
	if m.templateSvc == nil {
		return nil
	}
	if err := m.templateSvc.EnsureBuiltins(ctx); err != nil {
		return fmt.Errorf("m01: seed built-in collection templates: %w", err)
	}
	return nil
}

// StartBackground launches M01 maintenance loops (D40 reconciliation). It is
// called only for a cancellable production context.
func (m *Module) StartBackground(ctx context.Context) {
	if m.reconcile != nil {
		go m.reconcile.Run(ctx)
	}
}
