package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/modules/m08/notify"
	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/foundation/httpx"
	"github.com/metriccenter/metriccenter/platform/foundation/module"
	"github.com/metriccenter/metriccenter/platform/foundation/system"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	m01 "github.com/metriccenter/metriccenter/platform/modules/m01"
	m01seed "github.com/metriccenter/metriccenter/platform/modules/m01/seed"
	m05 "github.com/metriccenter/metriccenter/platform/modules/m05"
	m06 "github.com/metriccenter/metriccenter/platform/modules/m06"
	m07 "github.com/metriccenter/metriccenter/platform/modules/m07"
	m08 "github.com/metriccenter/metriccenter/platform/modules/m08"
	m08refs "github.com/metriccenter/metriccenter/platform/modules/m08/references"
	m09 "github.com/metriccenter/metriccenter/platform/modules/m09"
)

// resolveDatabaseMode resolves the startup mode. Precedence: --database.mode,
// then METRIC_CENTER_DB_MODE, then legacy. Unknown values are rejected so a
// typo cannot silently boot the wrong schema.
func resolveDatabaseMode(flagValue string) (string, error) {
	mode := strings.ToLower(strings.TrimSpace(flagValue))
	if mode == "" {
		mode = db.StartupMode()
	}
	if mode == "" {
		return db.StartupModeLegacy, nil
	}
	switch mode {
	case db.StartupModeLegacy, db.StartupModeV3:
		return mode, nil
	default:
		return "", fmt.Errorf("unsupported database mode %q (want %q or %q)",
			mode, db.StartupModeLegacy, db.StartupModeV3)
	}
}

// runV3 boots the v3-only line: versioned migrations, v3 seed and the v3 module
// registry. Legacy /api/v2 routes and background workers are intentionally not
// started because they depend on the AutoMigrate schema.
func runV3(ctx context.Context) {
	if err := db.InitV3(); err != nil {
		log.Fatalf("failed to initialize v3 database: %v", err)
	}
	if err := seed.CoreV3(db.DB, *businessDomainsFile); err != nil {
		log.Fatalf("failed to seed v3 core data: %v", err)
	}
	if err := m01seed.Run(db.DB); err != nil {
		log.Fatalf("failed to seed m01 data: %v", err)
	}

	promURL, err := parseURL(*prometheusURL)
	if err != nil {
		log.Fatalf("invalid prometheus.url: %v", err)
	}
	r, err := setupV3Router(ctx, *webStaticDir, m06.Options{
		EnvFile: filepath.Join(*configDir, "prom-retention.env"),
		PromURL: promURL,
	})
	if err != nil {
		log.Fatalf("failed to setup v3 router: %v", err)
	}

	log.Printf(">>> database mode: v3 (driver=%s)", db.DBDriver())
	serveHTTP(ctx, r)
}

// setupV3Router assembles the v3-only HTTP surface: shared middleware, the v3
// module registry (system + business modules) and the optional SPA fallback.
func setupV3Router(ctx context.Context, staticDir string, m06Opts m06.Options) (*gin.Engine, error) {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(httpx.RequestID())
	r.Use(httpx.AccessLog(log.Default()))
	// 与 legacy 一致：A2 同源部署下 CORS 不生效，仅服务开发态跨端口联调。
	// 演进到 nginx 反代（S2）后必须收紧为来源白名单。
	r.Use(cors.Default())
	// D27: /api/v3/edge/* is token-only (edge agents are not platform users);
	// exempt it from the global user-auth gate so EdgeTokenMiddleware owns it.
	auth.PublicPathPrefixes = append(auth.PublicPathPrefixes, "/api/v3/edge/")
	r.Use(auth.AuthMiddleware(auth.NewService(auth.NewRepository(db.DB))))

	apiV3 := r.Group("/api/v3")
	// Alertmanager callbacks are machine-to-machine: exempt the M08 webhook
	// bridge from the user-auth gate (D38 keeps them under the v3 prefix).
	auth.PublicPathPrefixes = append(auth.PublicPathPrefixes, "/api/v3/platform/webhooks/")
	m09Module, err := mountV3Modules(ctx, apiV3.Group("/platform"), apiV3.Group("/edge"), m06Opts)
	if err != nil {
		return nil, err
	}
	// D30: the Prometheus-compatible query surface lives under /api/v1 and is
	// only mounted in v3-only mode (the transition mode keeps the legacy proxy).
	if err := m09Module.RegisterQueryRoutes(r.Group("/api/v1")); err != nil {
		return nil, fmt.Errorf("m09: register query routes: %w", err)
	}
	// A2 部署拓扑：静态兜底必须最后注册，保证所有 /api/* 路由优先命中。
	if staticDir != "" {
		if err := registerSPA(r, staticDir); err != nil {
			return nil, err
		}
		log.Printf(">>> serving frontend static files from %s", staticDir)
	}
	return r, nil
}

// mountV3Modules builds the v3 module registry and mounts every module under
// the supplied platform group (expected prefix: /api/v3/platform). The edge
// group (expected prefix: /api/v3/edge) receives M09's token-only protocol.
func mountV3Modules(ctx context.Context, platform, edge *gin.RouterGroup, m06Opts m06.Options) (*m09.Module, error) {
	registry := module.NewRegistry()
	systemModule := system.NewModule(db.DB, system.Options{
		Driver:  db.DBDriver(),
		Modules: registry.Names,
	})
	if err := registry.Register(systemModule); err != nil {
		return nil, err
	}
	// M01 is built first so M07 (label-template usage) and M09 (sync result
	// sink) can receive its ports without importing M01.
	m01Module, err := m01.NewModule(db.DB, m01.Options{})
	if err != nil {
		return nil, fmt.Errorf("register m01 v3 module: %w", err)
	}
	// M09 owns monitoring retirement (D23). Build it before M06 so its
	// MonitoringRetirer can be injected into M06; registration order below
	// keeps the meta list as system → m06 → m07 → m01 → m09 → auth.
	m09Module, err := m09.NewModule(db.DB, m09.Options{
		PromURL:          m06Opts.PromURL,
		ConfigOutputDir:  *configDir,
		AlertmanagerAddr: alertmanagerHost(),
		EdgePackagesDir:  *edgePackageDir,
		SyncSink:         m01Module.SyncResultSink(),
	})
	if err != nil {
		return nil, fmt.Errorf("register m09 v3 module: %w", err)
	}
	// M08 alert convergence: owns alertmanager.yml generation, the internal
	// reload submodule, notification channels/templates and the alert-event
	// ledger. Its snapshot is the single authoritative history; M09's unified
	// config-artifact view reads it read-only and never fans it out.
	m08Module, err := m08.NewModule(db.DB, m08.Options{
		AlertmanagerURL:     alertmanagerBaseURL(),
		ConfigDir:           amConfigDir(),
		ReloadURL:           amReloadURL(),
		BridgeBaseURL:       bridgeBaseURL(),
		DomainAuthorizer:    m08refs.NewDomainAuthorizer(db.DB),
		ResourceNamer:       m08refs.NewResourceNamer(db.DB),
		AllowPrivateWebhook: strings.EqualFold(strings.TrimSpace(os.Getenv("METRIC_CENTER_ALLOW_PRIVATE_WEBHOOKS")), "true"),
	})
	if err != nil {
		return nil, fmt.Errorf("register m08 v3 module: %w", err)
	}
	// M05 dashboard: the homepage aggregate and the mounted panel registry. It is
	// the v3 replacement for the legacy /api/v2/platform/dashboard surface; the
	// response structs stay shared with `platform/dashboard` so the frontend
	// contract does not change (only the aggregation reads the v3 schema).
	// PromURL is the platform-level Prometheus URL (already threaded through
	// m06.Options by the v3 bootstrap), used for the collection_health `up` query.
	m05Module, err := m05.NewModule(db.DB, m05.Options{PromURL: m06Opts.PromURL})
	if err != nil {
		return nil, fmt.Errorf("register m05 v3 module: %w", err)
	}
	// Tests may inject a fake retirer; production lets M09 supply the default.
	if m06Opts.Monitoring == nil {
		m06Opts.Monitoring = m09Module.MonitoringRetirer()
	}
	// Order: system → m06 → m07 → m01 → m09 → auth. M06 owns tenant/network-domain
	// administration; M07 consumes the domain usability view; M01 owns strategy
	// source data; M09 owns access, edge agents, config sync and the query surface.
	m06Module, err := m06.NewModule(db.DB, m06Opts)
	if err != nil {
		return nil, fmt.Errorf("register m06 v3 module: %w", err)
	}
	if err := registry.Register(m06Module); err != nil {
		return nil, err
	}
	m07Module, err := m07.NewModule(db.DB, m07.Options{
		LabelTemplateUsage: m01Module.LabelTemplateUsageChecker(),
	})
	if err != nil {
		return nil, fmt.Errorf("register m07 v3 module: %w", err)
	}
	if err := registry.Register(m07Module); err != nil {
		return nil, err
	}
	if err := registry.Register(m01Module); err != nil {
		return nil, err
	}
	if err := registry.Register(m09Module); err != nil {
		return nil, err
	}
	if err := registry.Register(m08Module); err != nil {
		return nil, err
	}
	if err := registry.Register(m05Module); err != nil {
		return nil, err
	}
	// M03 v3 认证面尚未重写：v3-only 模式临时复用 legacy auth handler。
	// v3 00000 baseline 已按同构列建 users / sessions / login_logs，切换成本低；
	// M03 v3 模块落地后替换本适配器（接口路径保持 /api/v3/platform/auth/*）。
	if err := registry.Register(v3AuthModule{}); err != nil {
		return nil, err
	}
	if err := registry.Mount(platform); err != nil {
		return nil, err
	}
	if err := m09Module.RegisterEdgeRoutes(edge); err != nil {
		return nil, fmt.Errorf("m09: register edge routes: %w", err)
	}
	if err := m08Module.RegisterWebhookRoutes(platform); err != nil {
		return nil, fmt.Errorf("m08: register webhook routes: %w", err)
	}
	if ctx != nil && ctx.Done() != nil {
		m08Module.StartBackground(ctx)
	}
	// Start background loops only for a cancellable (production) context;
	// tests pass context.Background() (nil Done) to avoid stray goroutines.
	if ctx != nil && ctx.Done() != nil {
		m09Module.StartBackground(ctx)
		m01Module.StartBackground(ctx)
	}
	log.Printf(">>> v3 modules: %v", registry.Names())
	return m09Module, nil
}

// v3AuthModule mounts the legacy auth handlers under the v3 prefix while the
// M03 rewrite is pending. It is a wiring adapter only: no business logic lives
// here, and it is replaced by the M03 v3 module once that lands.
type v3AuthModule struct{}

func (v3AuthModule) Name() string { return "auth" }

func (v3AuthModule) RegisterRoutes(platform *gin.RouterGroup) error {
	auth.RegisterRoutes(platform, db.DB)
	return nil
}

// serveHTTP starts the HTTP server and shuts it down when ctx is cancelled.
func serveHTTP(ctx context.Context, handler http.Handler) {
	srv := &http.Server{Addr: *listenAddr, Handler: handler}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}()

	log.Printf(">>> metric-center listening on %s", *listenAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("failed to start metric-center: %v", err)
	}
}

// alertmanagerBaseURL parses --alertmanager.url (nil when unparsable).
func alertmanagerHost() string {
	parsed := alertmanagerBaseURL()
	if parsed == nil {
		return ""
	}
	return parsed.Host
}

func alertmanagerBaseURL() *url.URL {
	parsed, err := parseURL(*alertmanagerURL)
	if err != nil {
		log.Printf("[m08] invalid --alertmanager.url: %v", err)
		return nil
	}
	return parsed
}

// amReloadURL parses --config.am-reload-url when set.
func amReloadURL() *url.URL {
	if strings.TrimSpace(*configAMReloadURL) == "" {
		return nil
	}
	parsed, err := parseURL(*configAMReloadURL)
	if err != nil {
		log.Printf("[m08] invalid --config.am-reload-url: %v", err)
		return nil
	}
	return parsed
}

// amConfigDir resolves the Alertmanager config directory (falls back to the
// Prometheus config dir, matching the legacy local-delivery default).
func amConfigDir() string {
	if strings.TrimSpace(*configAMDir) != "" {
		return *configAMDir
	}
	return *configDir
}

// bridgeBaseURL derives the absolute base used in generated receiver URLs.
func bridgeBaseURL() string {
	if strings.TrimSpace(*notifyBridgeURL) != "" {
		return strings.TrimRight(*notifyBridgeURL, "/")
	}
	derived, err := notify.DeriveBridgeBaseURL(*listenAddr)
	if err != nil {
		log.Printf("[m08] derive bridge base url: %v", err)
		return ""
	}
	return derived
}
