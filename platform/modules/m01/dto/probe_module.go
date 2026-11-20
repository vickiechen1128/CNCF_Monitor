package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// ProbeModuleRequest is the blackbox module create/update payload.
type ProbeModuleRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
	Enabled *bool  `json:"enabled"`
}

// ProbeModuleResponse is the blackbox module projection.
type ProbeModuleResponse struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Content            string    `json:"content"`
	IsBuiltin          bool      `json:"is_builtin"`
	Enabled            bool      `json:"enabled"`
	ReferencedJobCount int64     `json:"referenced_job_count"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// FromProbeModule maps a domain probe module plus its reference count.
func FromProbeModule(item *domain.ProbeModule, referencedJobCount int64) ProbeModuleResponse {
	return ProbeModuleResponse{
		ID: item.ID, Name: item.Name, Content: item.Content,
		IsBuiltin: item.IsBuiltin, Enabled: item.Enabled,
		ReferencedJobCount: referencedJobCount,
		CreatedAt:          item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}
