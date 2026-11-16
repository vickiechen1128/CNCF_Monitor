package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// LabelTemplateRequest is the create/update payload of a label template.
type LabelTemplateRequest struct {
	Name             string                `json:"name"`
	ResourceCategory string                `json:"resource_category"`
	IsDefault        bool                  `json:"is_default"`
	Mappings         []domain.LabelMapping `json:"mappings"`
}

// ToDomain converts the request into a domain entity (without ID/timestamps).
func (r LabelTemplateRequest) ToDomain() *domain.LabelTemplate {
	return &domain.LabelTemplate{
		Name:             r.Name,
		ResourceCategory: domain.Category(r.ResourceCategory),
		IsDefault:        r.IsDefault,
		Mappings:         r.Mappings,
	}
}

// LabelTemplateResponse is the v3 label template projection.
type LabelTemplateResponse struct {
	ID               string                `json:"id"`
	Name             string                `json:"name"`
	ResourceCategory string                `json:"resource_category"`
	IsDefault        bool                  `json:"is_default"`
	Mappings         []domain.LabelMapping `json:"mappings"`
	CreatedAt        time.Time             `json:"created_at"`
	UpdatedAt        time.Time             `json:"updated_at"`
}

// FromLabelTemplate maps a domain entity to the v3 projection.
func FromLabelTemplate(item *domain.LabelTemplate) LabelTemplateResponse {
	mappings := item.Mappings
	if mappings == nil {
		mappings = []domain.LabelMapping{}
	}
	return LabelTemplateResponse{
		ID:               item.ID,
		Name:             item.Name,
		ResourceCategory: string(item.ResourceCategory),
		IsDefault:        item.IsDefault,
		Mappings:         mappings,
		CreatedAt:        item.CreatedAt,
		UpdatedAt:        item.UpdatedAt,
	}
}

// FromLabelTemplates maps a page of domain entities.
func FromLabelTemplates(items []*domain.LabelTemplate) []LabelTemplateResponse {
	out := make([]LabelTemplateResponse, 0, len(items))
	for _, item := range items {
		out = append(out, FromLabelTemplate(item))
	}
	return out
}
