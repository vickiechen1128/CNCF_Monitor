package dto

import (
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// CIModelResponse is the API view of one CI model
// (SRS Module_07 v2.2 §5.8 FR-32).
type CIModelResponse struct {
	ResourceCategory string                      `json:"resource_category"`
	CategoryLabel    string                      `json:"category_label"`
	BuiltinFields    []BuiltinFieldResponse      `json:"builtin_fields"`
	CustomFields     []AttributeDefinitionResponse `json:"custom_fields"`
	AvailableGroups  []AttributeGroupOption      `json:"available_groups"`
}

// BuiltinFieldResponse is one platform-owned field. Immutable is always true:
// the page renders these fields read-only.
type BuiltinFieldResponse struct {
	Key               string `json:"key"`
	Label             string `json:"label"`
	DisplayGroup      string `json:"display_group"`
	DisplayGroupLabel string `json:"display_group_label"`
	DisplayOrder      int    `json:"display_order"`
	ValueType         string `json:"value_type"`
	Required          bool   `json:"required"`
	Immutable         bool   `json:"immutable"`
}

// AttributeGroupOption is one selectable display group.
type AttributeGroupOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// CIModelListResponse lists the six CI models.
type CIModelListResponse struct {
	List []CIModelResponse `json:"list"`
}

// FromBuiltinField renders one built-in field.
func FromBuiltinField(field domain.BuiltinField) BuiltinFieldResponse {
	return BuiltinFieldResponse{
		Key:               field.Key,
		Label:             field.Label,
		DisplayGroup:      string(field.Group),
		DisplayGroupLabel: domain.AttributeGroupLabel(field.Group),
		DisplayOrder:      field.Order,
		ValueType:         string(field.ValueType),
		Required:          field.Required,
		Immutable:         true,
	}
}

// AvailableAttributeGroups returns the fixed group list for the model page.
func AvailableAttributeGroups() []AttributeGroupOption {
	groups := domain.ValidAttributeGroups()
	out := make([]AttributeGroupOption, 0, len(groups))
	for _, group := range groups {
		out = append(out, AttributeGroupOption{
			Value: string(group),
			Label: domain.AttributeGroupLabel(group),
		})
	}
	return out
}

// FromCIModel renders one CI model.
func FromCIModel(category domain.Category, label string, builtin []domain.BuiltinField, custom []*domain.AttributeDefinition) CIModelResponse {
	builtinFields := make([]BuiltinFieldResponse, 0, len(builtin))
	for _, field := range builtin {
		builtinFields = append(builtinFields, FromBuiltinField(field))
	}
	customFields := make([]AttributeDefinitionResponse, 0, len(custom))
	for _, def := range custom {
		customFields = append(customFields, FromAttributeDefinition(def))
	}
	return CIModelResponse{
		ResourceCategory: string(category),
		CategoryLabel:    label,
		BuiltinFields:    builtinFields,
		CustomFields:     customFields,
		AvailableGroups:  AvailableAttributeGroups(),
	}
}
