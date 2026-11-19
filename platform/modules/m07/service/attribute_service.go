package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// AttributeService manages the generic capability attributes of M07
// (SRS Module_07 v2.1 §5.8 FR-31).
//
// The service only stores and validates capability FACTS: it never derives a
// monitor type and never injects Prometheus labels (see §3.5).
type AttributeService struct {
	defs      repository.AttributeDefinitionRepository
	attrs     repository.ResourceAttributeRepository
	resources repository.ResourceRepository
}

// NewAttributeService constructs the service.
func NewAttributeService(
	defs repository.AttributeDefinitionRepository,
	attrs repository.ResourceAttributeRepository,
	resources repository.ResourceRepository,
) *AttributeService {
	return &AttributeService{defs: defs, attrs: attrs, resources: resources}
}

// ListDefinitions returns the capability dictionary, optionally per category.
func (s *AttributeService) ListDefinitions(ctx context.Context, category domain.Category) ([]*domain.AttributeDefinition, error) {
	return s.defs.List(ctx, category)
}

// CreateDefinition registers a new capability key. No schema change is needed,
// so a new hardware capability never requires a release (NFR-23).
func (s *AttributeService) CreateDefinition(ctx context.Context, def *domain.AttributeDefinition) (*domain.AttributeDefinition, error) {
	def.Key = strings.TrimSpace(def.Key)
	def.Enabled = true
	if err := def.Validate(); err != nil {
		return nil, err
	}
	if _, found, err := s.defs.FindByKey(ctx, def.ResourceCategory, def.Key); err != nil {
		return nil, err
	} else if found {
		return nil, &domain.ValidationError{
			Field:   "attribute_key",
			Message: fmt.Sprintf("attribute %q already exists for category %q", def.Key, def.ResourceCategory),
		}
	}
	id, err := domain.NewResourceID()
	if err != nil {
		return nil, err
	}
	def.ID = id
	if err := s.defs.Create(ctx, def); err != nil {
		return nil, err
	}
	return s.defs.Get(ctx, def.ID)
}

// UpdateDefinition edits the mutable fields. The key and resource category are
// immutable so existing values keep their meaning.
func (s *AttributeService) UpdateDefinition(ctx context.Context, id string, patch *domain.AttributeDefinition, enabled *bool) (*domain.AttributeDefinition, error) {
	existing, err := s.defs.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	existing.DisplayName = strings.TrimSpace(patch.DisplayName)
	existing.ValueType = patch.ValueType
	existing.EnumOptions = patch.EnumOptions
	existing.Required = patch.Required
	existing.Description = patch.Description
	if enabled != nil {
		existing.Enabled = *enabled
	}
	if err := existing.Validate(); err != nil {
		return nil, err
	}
	if err := s.defs.Update(ctx, existing); err != nil {
		return nil, err
	}
	return s.defs.Get(ctx, id)
}

// DeleteDefinition removes an unused capability key. A key still carrying
// resource values may only be disabled (FR-31 / NFR-23).
func (s *AttributeService) DeleteDefinition(ctx context.Context, id string) error {
	existing, err := s.defs.Get(ctx, id)
	if err != nil {
		return err
	}
	count, err := s.defs.CountResourceValues(ctx, existing.Key)
	if err != nil {
		return err
	}
	if count > 0 {
		return &domain.ValidationError{
			Field: "id",
			Message: fmt.Sprintf(
				"attribute %q is used by %d resource(s); disable it instead of deleting", existing.Key, count),
		}
	}
	return s.defs.SoftDelete(ctx, id)
}

// ListResourceAttributes returns the capability values of one resource.
func (s *AttributeService) ListResourceAttributes(ctx context.Context, resourceID string) ([]*domain.ResourceAttribute, error) {
	if _, err := s.resources.Get(ctx, resourceID); err != nil {
		return nil, err
	}
	return s.attrs.ListByResource(ctx, resourceID)
}

// AttributeValue is one key/value pair supplied by the API. An empty value
// clears the attribute.
type AttributeValue struct {
	Key   string
	Value string
}

// ReplaceResourceAttributes validates and stores the whole attribute set of a
// resource in one transaction.
func (s *AttributeService) ReplaceResourceAttributes(ctx context.Context, resourceID string, values []AttributeValue) ([]*domain.ResourceAttribute, error) {
	resource, err := s.resources.Get(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	definitions, err := s.defs.List(ctx, resource.Category)
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]*domain.AttributeDefinition, len(definitions))
	for _, def := range definitions {
		byKey[def.Key] = def
	}

	stored := make([]*domain.ResourceAttribute, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, item := range values {
		key := strings.TrimSpace(item.Key)
		if key == "" {
			return nil, &domain.ValidationError{Field: "attributes", Message: "attribute key is required"}
		}
		if _, duplicated := seen[key]; duplicated {
			return nil, &domain.ValidationError{
				Field: "attributes", Message: fmt.Sprintf("attribute %q is duplicated", key),
			}
		}
		seen[key] = struct{}{}

		def, ok := byKey[key]
		if !ok {
			return nil, &domain.ValidationError{
				Field: "attributes",
				Message: fmt.Sprintf(
					"attribute %q is not registered for category %q", key, resource.Category),
			}
		}
		if !def.Enabled {
			return nil, &domain.ValidationError{
				Field: "attributes", Message: fmt.Sprintf("attribute %q is disabled", key),
			}
		}
		normalized, err := def.ValidateValue(item.Value)
		if err != nil {
			return nil, err
		}
		if normalized == "" {
			continue
		}
		stored = append(stored, &domain.ResourceAttribute{
			ResourceID: resourceID,
			Key:        key,
			Value:      normalized,
		})
	}
	if err := s.attrs.Replace(ctx, resourceID, stored); err != nil {
		return nil, err
	}
	return s.attrs.ListByResource(ctx, resourceID)
}
