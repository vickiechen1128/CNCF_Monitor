package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// AttributeDefinitionRequest is the create/update payload of a custom field
// (SRS Module_07 v2.2 §5.8 FR-31).
type AttributeDefinitionRequest struct {
	Key              string   `json:"attribute_key"`
	DisplayName      string   `json:"display_name"`
	ValueType        string   `json:"value_type"`
	ResourceCategory string   `json:"resource_category"`
	EnumOptions      []string `json:"enum_options,omitempty"`
	Required         bool     `json:"required,omitempty"`
	DisplayGroup     string   `json:"display_group,omitempty"`
	DisplayOrder     int      `json:"display_order,omitempty"`
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
		Group:            domain.AttributeGroup(r.DisplayGroup),
		Order:            r.DisplayOrder,
		Description:      r.Description,
	}
}

// AttributeDefinitionResponse is the API view of a custom field.
type AttributeDefinitionResponse struct {
	ID                string   `json:"id"`
	Key               string   `json:"attribute_key"`
	DisplayName       string   `json:"display_name"`
	ValueType         string   `json:"value_type"`
	ResourceCategory  string   `json:"resource_category"`
	EnumOptions       []string `json:"enum_options,omitempty"`
	Required          bool     `json:"required"`
	Status            string   `json:"status"`
	Enabled           bool     `json:"enabled"` // 兼容旧前端：等价于 status=active
	DisplayGroup      string   `json:"display_group"`
	DisplayGroupLabel string   `json:"display_group_label"`
	DisplayOrder      int      `json:"display_order"`
	Description       string   `json:"description,omitempty"`
	CreatedAt         string   `json:"created_at,omitempty"`
	UpdatedAt         string   `json:"updated_at,omitempty"`
}

// FromAttributeDefinition renders one custom field.
func FromAttributeDefinition(def *domain.AttributeDefinition) AttributeDefinitionResponse {
	status := def.EffectiveStatus()
	return AttributeDefinitionResponse{
		ID:                def.ID,
		Key:               def.Key,
		DisplayName:       def.DisplayName,
		ValueType:         string(def.ValueType),
		ResourceCategory:  string(def.ResourceCategory),
		EnumOptions:       def.EnumOptions,
		Required:          def.Required,
		Status:            string(status),
		Enabled:           status == domain.AttributeStatusActive,
		DisplayGroup:      string(def.Group),
		DisplayGroupLabel: domain.AttributeGroupLabel(def.Group),
		DisplayOrder:      def.Order,
		Description:       def.Description,
		CreatedAt:         formatAttributeTime(def.CreatedAt),
		UpdatedAt:         formatAttributeTime(def.UpdatedAt),
	}
}

// RemoveDefinitionResponse reports how a custom field left the model (FR-34).
type RemoveDefinitionResponse struct {
	ID         string `json:"id"`
	Mode       string `json:"mode"`
	UsageCount int64  `json:"usage_count"`
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
