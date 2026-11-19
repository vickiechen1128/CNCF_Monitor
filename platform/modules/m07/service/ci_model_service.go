package service

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// CIModel is the field model of one CI type (SRS Module_07 v2.2 §5.8 FR-32):
// the platform-owned built-in fields plus the custom fields currently in the
// model. Removed custom fields are not part of the model.
type CIModel struct {
	Category      domain.Category
	CategoryLabel string
	Builtin       []domain.BuiltinField
	Custom        []*domain.AttributeDefinition
}

// CIModelService reads the CI models. Built-in fields come from the platform
// code (domain.BuiltinFields); custom fields come from the dictionary.
type CIModelService struct {
	defs repository.AttributeDefinitionRepository
}

// NewCIModelService constructs the service.
func NewCIModelService(defs repository.AttributeDefinitionRepository) *CIModelService {
	return &CIModelService{defs: defs}
}

// List returns the six CI models in contract order.
func (s *CIModelService) List(ctx context.Context) ([]*CIModel, error) {
	categories := domain.AllCategories()
	out := make([]*CIModel, 0, len(categories))
	for _, category := range categories {
		model, err := s.Get(ctx, category)
		if err != nil {
			return nil, err
		}
		out = append(out, model)
	}
	return out, nil
}

// Get returns one CI model with its active custom fields.
func (s *CIModelService) Get(ctx context.Context, category domain.Category) (*CIModel, error) {
	if !category.Valid() {
		return nil, &domain.ValidationError{
			Field:   "resource_category",
			Message: fmt.Sprintf("must be one of %s", domain.CategoryHint()),
		}
	}
	custom, err := s.defs.List(ctx, category, domain.AttributeStatusActive)
	if err != nil {
		return nil, err
	}
	return &CIModel{
		Category:      category,
		CategoryLabel: domain.CategoryLabel(category),
		Builtin:       domain.BuiltinFields(category),
		Custom:        custom,
	}, nil
}
