// Package m09 is the Module 09 v3 composition root: network domain access &
// onboarding, edge agent lifecycle, config sync (snapshot atomic switch) and
// the Prometheus-compatible query surface with single-dimension network-domain
// isolation (D28).
package m09

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/handler"
	m09refs "github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

// Options carries optional deployment wiring for M09. Empty values must degrade
// safely (downstream features return a retryable 503 until configured).
type Options struct {
	// PromURL is the optional center Prometheus base URL used by the query
	// proxy and config-generation probes.
	PromURL *url.URL
	// ConfigOutputDir is the directory where generated config snapshots are
	// staged before being published to edge agents.
	ConfigOutputDir string
	// EdgePackagesDir is the offline package directory read for
	// release_meta.json and tar.gz downloads (default dist/edge-package).
	EdgePackagesDir string
}

// Module wires M09 v3 repositories, services and handlers.
type Module struct {
	handlers handler.Handlers
	onboard  *service.OnboardingService
	edge     *service.EdgeService
	config   *service.ConfigSyncService
	query    *service.QueryService
	opts     Options
}

// NewModule constructs the M09 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m09: database is required")
	}
	repo := repository.NewGORMRepository(db)
	onboarding := service.NewOnboardingService(repo, repo)
	edge := service.NewEdgeService(repo, repo)
	sources := m09refs.NewGORMSourceReader(db)
	store := storage.NewContentStore(opts.ConfigOutputDir)
	configSync := service.NewConfigSyncService(repo, sources, store, nil)
	query := service.NewQueryService(opts.PromURL, repo, repo)
	packages := service.NewPackageService(opts.EdgePackagesDir)
	return &Module{
		handlers: handler.Handlers{
			Onboarding: handler.NewOnboardingHandler(onboarding),
			Edge:       handler.NewEdgeHandler(edge, configSync),
			Agents:     handler.NewAgentHandler(edge),
			Snapshots:  handler.NewSnapshotHandler(onboarding, configSync),
			Query:      handler.NewQueryHandler(query),
			Packages:   handler.NewPackageHandler(packages),
			EdgeAuth:   service.NewTokenValidator(repo),
		},
		onboard: onboarding,
		edge:    edge,
		config:  configSync,
		query:   query,
		opts:    opts,
	}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m09" }

// RegisterRoutes mounts M09 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterPlatformRoutes(platform, m.handlers)
	return nil
}

// RegisterEdgeRoutes mounts the machine-to-machine edge protocol under the
// given edge group (expected prefix: /api/v3/edge). The group is NOT covered
// by the global user AuthMiddleware; access control is the edge token only
// (D27), enforced by EdgeTokenMiddleware mounted inside.
func (m *Module) RegisterEdgeRoutes(edge *gin.RouterGroup) error {
	handler.RegisterEdgeRoutes(edge, m.handlers)
	return nil
}

// MonitoringRetirer returns the port M06 invokes to cascade monitoring cleanup
// when a network domain is deleted. Owned by M09 per D23.
func (m *Module) MonitoringRetirer() references.MonitoringRetirer {
	return m.onboard
}

// ConfigSync returns the config sync service so the bootstrap can run the
// source-change watcher and trigger an initial sync.
func (m *Module) ConfigSync() *service.ConfigSyncService {
	return m.config
}

// RegisterQueryRoutes mounts the Prometheus-compatible query surface
// (expected prefix: /api/v1). Only used in v3-only mode (D30).
func (m *Module) RegisterQueryRoutes(apiV1 *gin.RouterGroup) error {
	handler.RegisterQueryRoutes(apiV1, m.handlers.Query)
	return nil
}

// StartBackground launches the M09 maintenance loops: edge offline detection +
// heartbeat retention (1m) and config source-change watching (30s, with an
// immediate first pass). The loops stop when ctx is cancelled.
func (m *Module) StartBackground(ctx context.Context) {
	if m.edge != nil {
		go m.edge.RunMaintenance(ctx, time.Minute)
	}
	if m.config != nil {
		go m.config.RunWatcher(ctx, 30*time.Second)
	}
}
