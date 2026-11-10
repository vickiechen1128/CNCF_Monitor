package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// Label is a v3 resource label item.
type Label struct {
	ID         string    `json:"id"`
	ResourceID string    `json:"resource_id"`
	Key        string    `json:"key"`
	Value      string    `json:"value"`
	Source     string    `json:"source"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// CreateLabelRequest is the v3 add-label request.
type CreateLabelRequest struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// UpdateLabelRequest is the v3 update-label request.
type UpdateLabelRequest struct {
	Value string `json:"value"`
}

// FromLabels maps domain labels to DTOs.
func FromLabels(items []domain.Label) []Label {
	out := make([]Label, 0, len(items))
	for _, item := range items {
		out = append(out, Label{
			ID:         item.ID,
			ResourceID: item.ResourceID,
			Key:        item.Key,
			Value:      item.Value,
			Source:     string(item.Source),
			CreatedAt:  item.CreatedAt,
			UpdatedAt:  item.UpdatedAt,
		})
	}
	return out
}

// FromLabel maps one domain label to a DTO.
func FromLabel(item *domain.Label) Label {
	return Label{
		ID:         item.ID,
		ResourceID: item.ResourceID,
		Key:        item.Key,
		Value:      item.Value,
		Source:     string(item.Source),
		CreatedAt:  item.CreatedAt,
		UpdatedAt:  item.UpdatedAt,
	}
}
