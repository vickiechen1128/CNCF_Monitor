// Package m08 is the Module 08 v3 composition root: alert convergence and
// notification management.
//
// M08 owns the generated alertmanager.yml, the internal reload submodule, the
// notification channels/templates and the alert-event ledger. It writes network
// domain snapshots to M09 read-only (D31), never fans configuration out to edge
// domains and never edits Alertmanager's YAML by hand (NFR-01).
package m08

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/apply"
	"github.com/metriccenter/metriccenter/platform/modules/m08/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m08/references"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// Options carries the M08 deployment wiring. Every optional dependency must
// degrade safely: missing Alertmanager or reload targets yield retryable 503s
// instead of failing startup (D46/D48).
type Options struct {
	AlertmanagerURL *url.URL
	// ConfigDir is the Alertmanager config directory (alertmanager.yml target).
	ConfigDir string
	// ReloadURL overrides the reload endpoint (defaults to AlertmanagerURL).
	ReloadURL *url.URL
	// BridgeBaseURL is the absolute base used in generated receiver URLs.
	BridgeBaseURL string
	// DomainAuthorizer is the M06 read port used by silence/inhibition guards.
	DomainAuthorizer references.DomainAuthorizer
	ResourceNamer    references.ResourceNamer
	// Checker overrides the amtool checker (tests).
	Checker service.ConfigChecker
	// AllowPrivateWebhook relaxes the SSRF guard for internal targets (NFR-07).
	AllowPrivateWebhook bool
	RetentionDays       int
	ReconcileInterval   time.Duration
}

// Module wires the M08 repositories, services and handlers.
type Module struct {
	handlers  handler.Handlers
	config    *service.ConfigService
	events    *service.EventService
	reconcile *service.ReconcileService
}

// NewModule constructs the M08 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m08: database is required")
	}
	channels := repository.NewChannelRepository(db)
	templates := repository.NewTemplateRepository(db)
	snapshots := repository.NewSnapshotRepository(db)
	reloadLogs := repository.NewReloadLogRepository(db)
	events := repository.NewEventRepository(db)
	ruleRepo := repository.NewInhibitionRepository(db)
	audits := repository.NewAuditRepository(db)

	checker := opts.Checker
	if checker == nil {
		checker = service.NewAmtoolChecker()
	}
	reloadURL := opts.ReloadURL
	if reloadURL == nil {
		reloadURL = opts.AlertmanagerURL
	}
	var reloader apply.Reloader
	if reloadURL != nil {
		reloader = apply.NewHTTPReloader(reloadURL)
	}
	applier := apply.New(opts.ConfigDir, reloader, reloadLogs)

	configSvc := service.NewConfigService(snapshots, channels, ruleRepo, service.ConfigOptions{
		Checker: checker, Applier: applier, BridgeBaseURL: opts.BridgeBaseURL,
		ReloadLogs: reloadLogs,
	})
	eventSvc := service.NewEventService(events, service.EventOptions{
		Namer: opts.ResourceNamer, RetentionDays: opts.RetentionDays,
	})
	var amClient *service.AMClient
	if opts.AlertmanagerURL != nil {
		amClient = service.NewAMClient(opts.AlertmanagerURL)
	}
	var silenceClient service.SilenceClient
	if amClient != nil {
		silenceClient = amClient
	}
	silenceSvc := service.NewSilenceService(silenceClient, opts.DomainAuthorizer, audits, events)
	inhibitionSvc := service.NewInhibitionService(ruleRepo, configSvc)
	channelSvc := service.NewChannelService(channels, templates, snapshots, opts.AllowPrivateWebhook)
	templateSvc := service.NewTemplateService(templates, channels)
	bridgeSvc := service.NewBridgeService(channels, templates)
	var source service.AlertsSource
	if amClient != nil {
		source = amClient
	}
	reconcileSvc := service.NewReconcileService(eventSvc, source, opts.ReconcileInterval)

	// Seed the default configuration and built-in templates. Seeding is
	// idempotent and best-effort: it must not block a boot where Alertmanager
	// is not yet reachable (there is no reload during seed).
	if err := service.Seed(context.Background(), snapshots, templates, ruleRepo, configSvc, service.SeedOptions{}); err != nil {
		return nil, fmt.Errorf("m08: seed default configuration: %w", err)
	}

	return &Module{
		handlers: handler.Handlers{
			Config:     handler.NewConfigHandler(configSvc),
			Routes:     handler.NewRouteHandler(configSvc),
			Inhibition: handler.NewInhibitionHandler(inhibitionSvc),
			Channel:    handler.NewChannelHandler(channelSvc),
			Template:   handler.NewTemplateHandler(templateSvc),
			Silence:    handler.NewSilenceHandler(silenceSvc),
			Event:      handler.NewEventHandler(eventSvc),
			Alerts:     handler.NewAlertsHandler(amClient),
			Bridge:     handler.NewBridgeHandler(bridgeSvc, eventSvc),
		},
		config: configSvc, events: eventSvc, reconcile: reconcileSvc,
	}, nil
}

// Name returns the stable module name used by the v3 registry.
func (m *Module) Name() string { return "m08" }

// RegisterRoutes mounts the platform surface (expected prefix /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.handlers)
	return nil
}

// RegisterWebhookRoutes mounts the Alertmanager callbacks.
func (m *Module) RegisterWebhookRoutes(platform *gin.RouterGroup) error {
	handler.RegisterWebhookRoutes(platform, m.handlers)
	return nil
}

// StartBackground runs reconciliation and event retention until ctx is done.
func (m *Module) StartBackground(ctx context.Context) {
	if ctx == nil || ctx.Done() == nil {
		return
	}
	go m.reconcile.Run(ctx)
	go m.events.RunRetention(ctx)
}

// Config exposes the config service for tests and later wiring.
func (m *Module) Config() *service.ConfigService { return m.config }
