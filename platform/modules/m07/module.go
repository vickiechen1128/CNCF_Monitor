// Package m07 is the Module 07 v3 composition root.
package m07

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
	"github.com/metriccenter/metriccenter/platform/modules/m07/handler"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
	"gorm.io/gorm"
)

// Module wires M07 v3 repositories, services and handlers.
type Module struct {
	resources    *handler.ResourceHandler
	dictionaries *handler.DictionaryHandler
	labels       *handler.LabelHandler
	imports      *handler.ImportHandler
}

// NewModule constructs the M07 v3 module.
func NewModule(db *gorm.DB) (*Module, error) {
	if db == nil {
		return nil, fmt.Errorf("m07: database is required")
	}
	resourceRepo := repository.NewGORMRepository(db)
	dictionaryRepo := dictionary.NewGORMRepository(db)
	dictionarySvc := dictionary.NewService(dictionaryRepo)
	resourceSvc := service.NewResourceService(resourceRepo, dictionarySvc)
	labelSvc := service.NewLabelService(repository.NewGORMLabelRepository(db), resourceRepo)
	importSvc := service.NewImportService(
		resourceRepo,
		repository.NewGORMImportRepository(db),
		dictionarySvc,
		dictionarySvc,
	)
	refs := references.NewGORMReader(db)

	return &Module{
		resources:    handler.NewResourceHandler(resourceSvc, refs),
		dictionaries: handler.NewDictionaryHandler(dictionarySvc),
		labels:       handler.NewLabelHandler(labelSvc),
		imports:      handler.NewImportHandler(importSvc),
	}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m07" }

// RegisterRoutes mounts M07 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.resources, m.dictionaries, m.labels, m.imports)
	return nil
}
