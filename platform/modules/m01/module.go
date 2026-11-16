// Package m01 is the Module 01 v3 composition root.
//
// M01 owns monitoring strategies: exporter templates, default monitor-type
// mappings, scrape jobs, monitoring rules and metric catalogues. It never
// renders Prometheus configuration, writes M09 snapshots or triggers reloads;
// M09 pulls the source data and reports sync results back (D-2).
package m01

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// Repositories groups the M01 persistence adapters. Services are wired from
// this struct by the module composition root.
type Repositories struct {
	Exporters       repository.ExporterTemplateRepository
	Mappings        repository.MappingRepository
	Jobs            repository.JobRepository
	Rules           repository.RuleRepository
	Metrics         repository.MetricRepository
	BusinessMetrics repository.BusinessMetricRepository
	Installations   repository.InstallationRepository
	ProbeModules    repository.ProbeModuleRepository
}

// Module wires M01 v3 repositories, services and handlers.
type Module struct {
	repos     Repositories
	exporters *handler.ExporterTemplateHandler
	mappings  *handler.MappingHandler
}

// NewModule constructs the M01 v3 module.
func NewModule(db *gorm.DB) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m01: database is required")
	}
	repos := Repositories{
		Exporters:       repository.NewExporterTemplateRepository(db),
		Mappings:        repository.NewMappingRepository(db),
		Jobs:            repository.NewJobRepository(db),
		Rules:           repository.NewRuleRepository(db),
		Metrics:         repository.NewMetricRepository(db),
		BusinessMetrics: repository.NewBusinessMetricRepository(db),
		Installations:   repository.NewInstallationRepository(db),
		ProbeModules:    repository.NewProbeModuleRepository(db),
	}
	// D-3: M07 exposes no v3 label-template API yet; the no-op resolver accepts
	// ids and leaves display names empty until that lands.
	exporterSvc := service.NewExporterTemplateService(repos.Exporters, repos.Mappings)
	mappingSvc := service.NewMappingService(repos.Mappings, repos.Exporters, repos.Jobs, nil)

	return &Module{
		repos:     repos,
		exporters: handler.NewExporterTemplateHandler(exporterSvc),
		mappings:  handler.NewMappingHandler(mappingSvc),
	}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m01" }

// RegisterRoutes mounts M01 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.exporters, m.mappings)
	return nil
}

// Repositories exposes the persistence adapters for later services and tests.
func (m *Module) Repositories() Repositories { return m.repos }
