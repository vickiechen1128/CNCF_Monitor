package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// AttributeDefinitionRequest is the create/update payload of a capability key
// (SRS Module_07 v2.1 FR-31).
type AttributeDefinitionRequest struct {
	Key              string   `json:"attribute_key"`
	DisplayName      string   `json:"display_name"`
	ValueType        string   `json:"value_type"`
	ResourceCategory string   `json:"resource_category"`
	EnumOptions      []string `json:"enum_options,omitempty"`
	Required         bool     `json:"required,omitempty"`
	Enabled          *bool    `json:"enabled,omitempty"`
	Description      string   `json:"description,omitempty"`
}

// ToDomain converts the payload to a domain definition.
func (r AttributeDefinitionRequest) ToDomain() *domain.AttributeDefinition {
	return &domain.AttributeDefinition{
		Key:              r.Key,
		DisplayName:      r.DisplayName,
		ValueType:        domain.AttributeValueType(r.ValueType),
		ResourceCategory: domain.Category(r.ResourceCategory),
		EnumOptions:      r.EnumOptions,
		Required:         r.Required,
		Enabled:          r.Enabled == nil || *r.Enabled,
		Description:      r.Description,
	}
}

// AttributeDefinitionResponse is the API view of a capability key.
type AttributeDefinitionResponse struct {
	ID               string   `json:"id"`
	Key              string   `json:"attribute_key"`
	DisplayName      string   `json:"display_name"`
	ValueType        string   `json:"value_type"`
	ResourceCategory string   `json:"resource_category"`
	EnumOptions      []string `json:"enum_options,omitempty"`
	Required         bool     `json:"required"`
	Enabled          bool     `json:"enabled"`
	Description      string   `json:"description,omitempty"`
	CreatedAt        string   `json:"created_at,omitempty"`
	UpdatedAt        string   `json:"updated_at,omitempty"`
}

// FromAttributeDefinition renders one capability key.
func FromAttributeDefinition(def *domain.AttributeDefinition) AttributeDefinitionResponse {
	return AttributeDefinitionResponse{
		ID:               def.ID,
		Key:              def.Key,
		DisplayName:      def.DisplayName,
		ValueType:        string(def.ValueType),
		ResourceCategory: string(def.ResourceCategory),
		EnumOptions:      def.EnumOptions,
		Required:         def.Required,
		Enabled:          def.Enabled,
		Description:      def.Description,
		CreatedAt:        formatAttributeTime(def.CreatedAt),
		UpdatedAt:        formatAttributeTime(def.UpdatedAt),
	}
}

// AttributeValuePayload is one capability value.
type AttributeValuePayload struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// ReplaceAttributesRequest replaces the whole attribute set of a resource.
type ReplaceAttributesRequest struct {
	Attributes []AttributeValuePayload `json:"attributes"`
}

// ResourceAttributeResponse is the API view of one stored capability value.
type ResourceAttributeResponse struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// FromResourceAttribute renders one stored attribute.
func FromResourceAttribute(attr *domain.ResourceAttribute) ResourceAttributeResponse {
	return ResourceAttributeResponse{Key: attr.Key, Value: attr.Value}
}

func formatAttributeTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
