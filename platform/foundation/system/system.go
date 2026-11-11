// Package system exposes the v3 platform system endpoints.
//
//   - GET /api/v3/platform/health  liveness: process is up, no dependencies
//   - GET /api/v3/platform/ready   readiness: database reachable, migrations applied
//   - GET /api/v3/platform/meta    build / driver / module metadata
//
// Health and readiness are anonymous (they are wired into auth.healthPaths) so
// orchestrators and load balancers can probe them without credentials. Meta
// exposes no secrets and is likewise anonymous.
package system

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/api/response"
)

// readinessTimeout bounds the dependency probe so a hung database cannot pile
// up readiness requests.
const readinessTimeout = 2 * time.Second

// Options configures the system module metadata.
type Options struct {
	// Driver is the configured database driver (sqlite / postgres).
	Driver string
	// Modules returns the registered module names. It is called lazily so the
	// value reflects the final registry contents.
	Modules func() []string
}

// Module implements the v3 system endpoints.
type Module struct {
	db      *gorm.DB
	driver  string
	modules func() []string
}

// NewModule constructs the system module. A nil database is allowed: health
// still works, readiness reports unavailable.
func NewModule(db *gorm.DB, opts Options) *Module {
	modules := opts.Modules
	if modules == nil {
		modules = func() []string { return nil }
	}
	return &Module{db: db, driver: opts.Driver, modules: modules}
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "system" }

// RegisterRoutes mounts the system endpoints under the platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	platform.GET("/health", m.health)
	platform.GET("/ready", m.ready)
	platform.GET("/meta", m.meta)
	return nil
}

// health is a pure liveness probe: it never touches the database.
func (m *Module) health(c *gin.Context) {
	c.JSON(http.StatusOK, response.Success(gin.H{"status": "ok"}))
}

// ready verifies the database connection and that v3 migrations have run.
func (m *Module) ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), readinessTimeout)
	defer cancel()

	schemaVersion, err := m.probe(ctx)
	if err != nil {
		response.ServiceUnavailable(c, err)
		return
	}
	c.JSON(http.StatusOK, response.Success(gin.H{
		"status":         "ready",
		"driver":         m.driver,
		"schema_version": schemaVersion,
	}))
}

// meta reports build and wiring metadata. Secrets (DSN, tokens) are never
// included.
func (m *Module) meta(c *gin.Context) {
	modules := m.modules()
	if modules == nil {
		modules = []string{}
	}
	c.JSON(http.StatusOK, response.Success(gin.H{
		"version": buildVersion(),
		"api":     "v3",
		"driver":  m.driver,
		"modules": modules,
	}))
}

// probe pings the database and returns the highest applied migration version.
func (m *Module) probe(ctx context.Context) (int64, error) {
	if m.db == nil {
		return 0, fmt.Errorf("system: database is not initialized")
	}
	sqlDB, err := m.db.DB()
	if err != nil {
		return 0, fmt.Errorf("system: get sql database: %w", err)
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		return 0, fmt.Errorf("system: ping database: %w", err)
	}

	var version sql.NullInt64
	if err := m.db.WithContext(ctx).Raw(`SELECT max(version) FROM schema_migrations`).Scan(&version).Error; err != nil {
		return 0, fmt.Errorf("system: read schema version: %w", err)
	}
	if !version.Valid {
		return 0, fmt.Errorf("system: no v3 migration applied")
	}
	return version.Int64, nil
}

// buildVersion resolves the main module version from build info, falling back
// to "dev" for untagged local builds.
func buildVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok || info.Main.Version == "" || info.Main.Version == "(devel)" {
		return "dev"
	}
	return info.Main.Version
}
