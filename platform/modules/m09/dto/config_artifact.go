package dto

import (
	"encoding/json"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// ConfigArtifactResponse is one row of the unified config-artifact history.
type ConfigArtifactResponse struct {
	ID                int64           `json:"id"`
	ArtifactType      string          `json:"artifact_type"`
	NetworkDomainID   string          `json:"network_domain_id,omitempty"`
	Version           string          `json:"version"`
	Checksum          string          `json:"checksum"`
	ValidationStatus  string          `json:"validation_status"`
	ValidationCause   string          `json:"validation_cause"`
	ValidationDetails json.RawMessage `json:"validation_details"`
	IsCurrent         bool            `json:"is_current"`
	GeneratedBy       string          `json:"generated_by"`
	GeneratedAt       *time.Time      `json:"generated_at,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	ContentAvailable  bool            `json:"content_available"`
}

// ListConfigArtifactsResponse is the unified history envelope (newest first).
type ListConfigArtifactsResponse struct {
	List  []ConfigArtifactResponse `json:"list"`
	Total int64                    `json:"total"`
}

// ConfigArtifactFileResponse is one previewable file inside an artifact.
type ConfigArtifactFileResponse struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

// ConfigArtifactPreviewResponse carries metadata plus the read-only file list.
type ConfigArtifactPreviewResponse struct {
	Artifact ConfigArtifactResponse       `json:"artifact"`
	Files    []ConfigArtifactFileResponse `json:"files"`
}

// FromConfigArtifact converts the service view to the API shape.
func FromConfigArtifact(item *service.ArtifactView) ConfigArtifactResponse {
	details := json.RawMessage(item.ValidationDetails)
	if len(details) == 0 {
		details = json.RawMessage("{}")
	}
	return ConfigArtifactResponse{
		ID:                item.ID,
		ArtifactType:      string(item.ArtifactType),
		NetworkDomainID:   item.NetworkDomainID,
		Version:           item.Version,
		Checksum:          item.Checksum,
		ValidationStatus:  item.ValidationStatus,
		ValidationCause:   item.ValidationCause,
		ValidationDetails: details,
		IsCurrent:         item.IsCurrent,
		GeneratedBy:       item.GeneratedBy,
		GeneratedAt:       item.GeneratedAt,
		CreatedAt:         item.CreatedAt,
		ContentAvailable:  item.ContentAvailable,
	}
}

// FromConfigArtifactPreview converts the preview view to the API shape.
func FromConfigArtifactPreview(preview *service.ArtifactPreview) ConfigArtifactPreviewResponse {
	files := make([]ConfigArtifactFileResponse, 0, len(preview.Files))
	for _, file := range preview.Files {
		files = append(files, ConfigArtifactFileResponse{Name: file.Name, Content: file.Content})
	}
	return ConfigArtifactPreviewResponse{
		Artifact: FromConfigArtifact(&preview.Artifact),
		Files:    files,
	}
}
