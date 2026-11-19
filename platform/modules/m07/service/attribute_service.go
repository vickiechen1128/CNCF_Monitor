package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// AttributeService manages the custom fields of the M07 CI model
// (SRS Module_07 v2.2 §5.8 FR-30~FR-34).
//
// The service only stores and validates capability FACTS: it never derives a
// monitor type and never injects Prometheus labels (see §3.5 / §3.6).
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

// Remove modes reported by RemoveDefinition (FR-34).
const (
	// RemoveModeDeleted: the field had no resource values and was deleted.
	RemoveModeDeleted = "deleted"
	// RemoveModeRemoved: the field still carries values, so it left the model
	// and kept its historical values.
	RemoveModeRemoved = "removed"
)

// RemoveResult reports how a custom field left the CI model.
type RemoveResult struct {
	Mode       string
	UsageCount int64
}

// ListDefinitions returns the custom field dictionary, optionally filtered by
// category and lifecycle state.
func (s *AttributeService) ListDefinitions(ctx context.Context, category domain.Category, statuses ...domain.AttributeStatus) ([]*domain.AttributeDefinition, error) {
	return s.defs.List(ctx, category, statuses...)
}

// CreateDefinition registers a new custom field. Registering a key whose
// previous definition was removed restores that definition instead of creating
// a duplicate, so historical values become visible again (FR-34).
func (s *AttributeService) CreateDefinition(ctx context.Context, def *domain.AttributeDefinition) (*domain.AttributeDefinition, error) {
	def.Key = strings.TrimSpace(def.Key)
	def.Status = domain.AttributeStatusActive
	applyAttributeDefaults(def)
	if err := def.Validate(); err != nil {
		return nil, err
	}
	existing, found, err := s.defs.FindByKey(ctx, def.ResourceCategory, def.Key)
	if err != nil {
		return nil, err
	}
	if found {
		if existing.EffectiveStatus() != domain.AttributeStatusRemoved {
			return nil, &domain.ValidationError{
				Field:   "attribute_key",
				Message: fmt.Sprintf("attribute %q already exists for category %q", def.Key, def.ResourceCategory),
			}
		}
		existing.DisplayName = def.DisplayName
		existing.ValueType = def.ValueType
		existing.EnumOptions = def.EnumOptions
		existing.Required = def.Required
		existing.Group = def.Group
		existing.Order = def.Order
		existing.Description = def.Description
		existing.Status = domain.AttributeStatusActive
		if err := s.defs.Update(ctx, existing); err != nil {
			return nil, err
		}
		return s.defs.Get(ctx, existing.ID)
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

// applyAttributeDefaults fills the group default so a registration that omits
// it still lands in a valid model position. The order keeps its zero value;
// a negative order is rejected by Validate instead of being silently fixed.
func applyAttributeDefaults(def *domain.AttributeDefinition) {
	if def.Group == "" {
		def.Group = domain.AttributeGroupProfile
	}
}

// UpdateDefinition edits the mutable fields. The key, resource category and
// lifecycle state are immutable: a removed field is restored by re-registering
// the same key, not by toggling a switch.
func (s *AttributeService) UpdateDefinition(ctx context.Context, id string, patch *domain.AttributeDefinition, _ *bool) (*domain.AttributeDefinition, error) {
	existing, err := s.defs.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.EffectiveStatus() == domain.AttributeStatusRemoved {
		return nil, &domain.ValidationError{
			Field:   "status",
			Message: fmt.Sprintf("attribute %q is removed from the model; re-register the key to restore it", existing.Key),
		}
	}
	existing.DisplayName = strings.TrimSpace(patch.DisplayName)
	existing.ValueType = patch.ValueType
	existing.EnumOptions = patch.EnumOptions
	existing.Required = patch.Required
	existing.Group = patch.Group
	existing.Order = patch.Order
	existing.Description = patch.Description
	applyAttributeDefaults(existing)
	if err := existing.Validate(); err != nil {
		return nil, err
	}
	if err := s.defs.Update(ctx, existing); err != nil {
		return nil, err
	}
	return s.defs.Get(ctx, id)
}

// RemoveDefinition takes a custom field out of the CI model (FR-34).
//
// The system decides how: an unused field is deleted outright; a field that
// still carries values is marked removed so the historical values survive.
func (s *AttributeService) RemoveDefinition(ctx context.Context, id string) (*RemoveResult, error) {
	existing, err := s.defs.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	count, err := s.defs.CountResourceValues(ctx, existing.Key)
	if err != nil {
		return nil, err
	}
	if count == 0 {
		if err := s.defs.SoftDelete(ctx, id); err != nil {
			return nil, err
		}
		return &RemoveResult{Mode: RemoveModeDeleted, UsageCount: 0}, nil
	}
	existing.Status = domain.AttributeStatusRemoved
	if err := s.defs.Update(ctx, existing); err != nil {
		return nil, err
	}
	return &RemoveResult{Mode: RemoveModeRemoved, UsageCount: count}, nil
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
		if def.EffectiveStatus() != domain.AttributeStatusActive {
			return nil, &domain.ValidationError{
				Field: "attributes", Message: fmt.Sprintf("attribute %q is removed from the model", key),
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
