// Package m06 is the Module 06 v3 composition root (system & platform
// administration, including multi-tenancy).
package m06

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m06/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
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
	domains *handler.NetworkDomainHandler
}

// NewModule constructs the M06 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m06: database is required")
	}
	_ = opts

	tenantSvc := service.NewTenantService(repository.NewGORMRepository(db))
	domainSvc := service.NewNetworkDomainService(
		repository.NewGORMNetworkDomainRepository(db),
		repository.NewGORMDictionaryRepository(db),
		references.NewGORMM07Reader(db),
		// M09/M11 v3 has not landed: retirement is a no-op and the impact view
		// reports monitoring_available=false (D19).
		references.NoopMonitoring{},
	)
	return &Module{
		tenants: handler.NewTenantHandler(tenantSvc),
		domains: handler.NewNetworkDomainHandler(domainSvc),
	}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m06" }

// RegisterRoutes mounts M06 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.tenants, m.domains)
	return nil
}
