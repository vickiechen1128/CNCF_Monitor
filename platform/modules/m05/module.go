// Package m05 is the Module 05 v3 composition root: custom UI / dashboard.
//
// M05 owns the homepage aggregate (`/api/v3/platform/dashboard/summary`) and the
// mounted Grafana panel registry (`/api/v3/platform/dashboard/panels`).
//
// The summary response structs are re-used verbatim from `platform/dashboard`
// (v2) so the frontend contract does not change; this module only re-implements
// the aggregation against the v3 shared schema (resources + six extension
// tables + m01_scrape_jobs + network_domains + dictionaries).
package m05

import (
	"fmt"
	"net/url"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m05/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m05/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m05/service"
)

// Options carries the M05 deployment wiring. Every optional dependency degrades
// safely: without a Prometheus URL collection_health is omitted (frontend shows
// "unavailable") instead of reporting a false zero.
type Options struct {
	// PromURL is the center Prometheus base URL used by the collection_health
	// aggregate (`up` instant query). Nil = not configured.
	PromURL *url.URL
	// UpHealthQuerier overrides the Prometheus querier (tests inject a fake).
	UpHealthQuerier domain.UpHealthQuerier
}

// Module wires the M05 repositories, services and handlers.
type Module struct {
	handlers handler.Handlers
}

// NewModule constructs the M05 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m05: database is required")
	}

	var health domain.UpHealthQuerier
	if opts.UpHealthQuerier != nil {
		health = opts.UpHealthQuerier
	} else if querier := repository.NewPromUpHealthQuerier(opts.PromURL, nil); querier != nil {
		health = querier
	}

	summarySvc := service.NewSummaryService(repository.NewGORMSummaryRepository(db), health)
	panelSvc := service.NewPanelService(repository.NewGORMPanelRepository(db))

	return &Module{handlers: handler.Handlers{
		Summary: handler.NewSummaryHandler(summarySvc),
		Panels:  handler.NewPanelHandler(panelSvc),
	}}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m05" }

// RegisterRoutes mounts M05 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.handlers)
	return nil
}
