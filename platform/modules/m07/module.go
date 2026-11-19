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

// Options carries optional cross-module ports for M07.
type Options struct {
	// LabelTemplateUsage guards label template deletion against M01 references.
	// A nil checker means "not referenced" (tests / standalone wiring).
	LabelTemplateUsage references.LabelTemplateUsageChecker
	// ChangeNotifier receives best-effort resource/template change notifications
	// so the composition root can trigger M01 reconcile + M09 config sync.
	ChangeNotifier references.ResourceChangeNotifier
}

// Module wires M07 v3 repositories, services and handlers.
type Module struct {
	resources      *handler.ResourceHandler
	dictionaries   *handler.DictionaryHandler
	labels         *handler.LabelHandler
	imports        *handler.ImportHandler
	labelTemplates *handler.LabelTemplateHandler
	attributes     *handler.AttributeHandler
}

// NewModule constructs the M07 v3 module.
func NewModule(db *gorm.DB, opts Options) (*Module, error) {
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
	attributeDefRepo := repository.NewAttributeDefinitionRepository(db)
	attributeRepo := repository.NewResourceAttributeRepository(db)
	// Excel 导入支持能力属性列（FR-31）：导入器需要字典做校验、需要写入端落值。
	importSvc.SetAttributeWriter(attributeDefRepo, attributeRepo)
	refs := references.NewGORMReader(db)
	labelTemplateSvc := service.NewLabelTemplateService(
		repository.NewLabelTemplateRepository(db),
		opts.LabelTemplateUsage,
	)
	attributeSvc := service.NewAttributeService(attributeDefRepo, attributeRepo, resourceRepo)

	if opts.ChangeNotifier != nil {
		resourceSvc.SetChangeNotifier(opts.ChangeNotifier)
		labelSvc.SetChangeNotifier(opts.ChangeNotifier)
		importSvc.SetChangeNotifier(opts.ChangeNotifier)
		labelTemplateSvc.SetChangeNotifier(opts.ChangeNotifier)
	}

	return &Module{
		resources:      handler.NewResourceHandler(resourceSvc, refs),
		dictionaries:   handler.NewDictionaryHandler(dictionarySvc),
		labels:         handler.NewLabelHandler(labelSvc),
		imports:        handler.NewImportHandler(importSvc),
		labelTemplates: handler.NewLabelTemplateHandler(labelTemplateSvc),
		attributes:     handler.NewAttributeHandler(attributeSvc),
	}, nil
}

// Name returns the stable module name used by the v3 module registry.
func (m *Module) Name() string { return "m07" }

// RegisterRoutes mounts M07 v3 under the given platform group
// (expected prefix: /api/v3/platform).
func (m *Module) RegisterRoutes(platform *gin.RouterGroup) error {
	handler.RegisterRoutes(platform, m.resources, m.dictionaries, m.labels, m.imports, m.labelTemplates, m.attributes)
	return nil
}
