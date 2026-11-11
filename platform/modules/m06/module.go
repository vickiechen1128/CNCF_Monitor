// Package m06 is the Module 06 v3 composition root (system & platform
// administration, including multi-tenancy).
package m06

import (
	"fmt"
	"net/url"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m06/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
	"github.com/metriccenter/metriccenter/platform/modules/m06/storage"
)

// Options carries optional deployment wiring for M06 sub-modules. Empty values
// must degrade safely (storage writes return an actionable 503).
type Options struct {
	// EnvFile is the prom-retention.env path used by storage settings.
	EnvFile string
	// PromURL is the optional Prometheus base URL used by storage probes.
	PromURL *url.URL
	// Monitoring is the optional M09/M11 retirement port; nil means no-op.
	Monitoring references.MonitoringRetirer
}

// Module wires M06 v3 repositories, services and handlers.
type Module struct {
	handlers handler.Handlers
}

// NewModule constructs the M06 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m06: database is required")
	}

	tenantSvc := service.NewTenantService(repository.NewGORMRepository(db))
	domainSvc := service.NewNetworkDomainService(
		repository.NewGORMNetworkDomainRepository(db),
		repository.NewGORMDictionaryRepository(db),
		references.NewGORMM07Reader(db),
		// M09/M11 v3 has not landed: the default no-op retirer reports
		// monitoring_available=false (D19). Tests may inject a fake.
		opts.Monitoring,
	)
	userSvc := service.NewUserService(repository.NewGORMUserRepository(db))
	loginLogSvc := service.NewLoginLogService(repository.NewGORMLoginLogRepository(db))
	storageSvc := storage.NewService(storage.Options{EnvFile: opts.EnvFile, PromURL: opts.PromURL})

	return &Module{handlers: handler.Handlers{
		Tenants:   handler.NewTenantHandler(tenantSvc),
		Domains:   handler.NewNetworkDomainHandler(domainSvc),
		Users:     handler.NewUserHandler(userSvc),
		LoginLogs: handler.NewLoginLogHandler(loginLogSvc),
		Storage:   handler.NewStorageHandler(storageSvc),
	}}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m06" }

// RegisterRoutes mounts M06 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.handlers)
	return nil
}
