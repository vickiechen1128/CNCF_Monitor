package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/foundation/httpx"
	"github.com/metriccenter/metriccenter/platform/foundation/module"
	"github.com/metriccenter/metriccenter/platform/foundation/system"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	m06 "github.com/metriccenter/metriccenter/platform/modules/m06"
	m07 "github.com/metriccenter/metriccenter/platform/modules/m07"
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

	promURL, err := parseURL(*prometheusURL)
	if err != nil {
		log.Fatalf("invalid prometheus.url: %v", err)
	}
	r, err := setupV3Router(*webStaticDir, m06.Options{
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
func setupV3Router(staticDir string, m06Opts m06.Options) (*gin.Engine, error) {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(httpx.RequestID())
	r.Use(httpx.AccessLog(log.Default()))
	// 与 legacy 一致：A2 同源部署下 CORS 不生效，仅服务开发态跨端口联调。
	// 演进到 nginx 反代（S2）后必须收紧为来源白名单。
	r.Use(cors.Default())
	r.Use(auth.AuthMiddleware(auth.NewService(auth.NewRepository(db.DB))))

	apiV3 := r.Group("/api/v3")
	if err := mountV3Modules(apiV3.Group("/platform"), m06Opts); err != nil {
		return nil, err
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
// the supplied platform group (expected prefix: /api/v3/platform).
func mountV3Modules(platform *gin.RouterGroup, m06Opts m06.Options) error {
	registry := module.NewRegistry()
	systemModule := system.NewModule(db.DB, system.Options{
		Driver:  db.DBDriver(),
		Modules: registry.Names,
	})
	if err := registry.Register(systemModule); err != nil {
		return err
	}
	// Order: system → m06 → m07 → auth. M06 owns tenant/network-domain
	// administration; M07 consumes the domain usability view.
	m06Module, err := m06.NewModule(db.DB, m06Opts)
	if err != nil {
		return fmt.Errorf("register m06 v3 module: %w", err)
	}
	if err := registry.Register(m06Module); err != nil {
		return err
	}
	m07Module, err := m07.NewModule(db.DB)
	if err != nil {
		return fmt.Errorf("register m07 v3 module: %w", err)
	}
	if err := registry.Register(m07Module); err != nil {
		return err
	}
	// M03 v3 认证面尚未重写：v3-only 模式临时复用 legacy auth handler。
	// v3 00000 baseline 已按同构列建 users / sessions / login_logs，切换成本低；
	// M03 v3 模块落地后替换本适配器（接口路径保持 /api/v3/platform/auth/*）。
	if err := registry.Register(v3AuthModule{}); err != nil {
		return err
	}
	if err := registry.Mount(platform); err != nil {
		return err
	}
	log.Printf(">>> v3 modules: %v", registry.Names())
	return nil
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
