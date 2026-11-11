// Package m06 is the Module 06 v3 composition root (system & platform
// administration, including multi-tenancy).
package m06

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m06/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// Options carries optional deployment wiring for later M06 sub-modules
// (storage settings / login-log cleanup). Empty values must degrade safely.
type Options struct {
	// EnvFile is the optional .env path used by storage settings.
	EnvFile string
	// PromURL is the optional Prometheus base URL used by storage probes.
	PromURL string
}

// Module wires M06 v3 repositories, services and handlers.
type Module struct {
	tenants *handler.TenantHandler
}

// NewModule constructs the M06 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m06: database is required")
	}
	_ = opts
	tenantSvc := service.NewTenantService(repository.NewGORMRepository(db))
	return &Module{tenants: handler.NewTenantHandler(tenantSvc)}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m06" }

// RegisterRoutes mounts M06 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.tenants)
	return nil
}
