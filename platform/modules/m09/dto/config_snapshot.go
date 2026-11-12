package dto

import (
	"encoding/json"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// ConfigSnapshotResponse is the read-only snapshot metadata (contract §4.1).
type ConfigSnapshotResponse struct {
	ID                int64           `json:"id"`
	NetworkDomainID   string          `json:"network_domain_id"`
	Version           string          `json:"version"`
	Checksum          string          `json:"checksum"`
	ValidationStatus  string          `json:"validation_status"`
	ValidationCause   string          `json:"validation_cause"`
	ValidationDetails json.RawMessage `json:"validation_details"`
	IsCurrent         bool            `json:"is_current"`
	GeneratedBy       string          `json:"generated_by"`
	CreatedAt         time.Time       `json:"created_at"`
}

// ListConfigSnapshotsResponse is the snapshot list envelope (newest first).
type ListConfigSnapshotsResponse struct {
	List  []ConfigSnapshotResponse `json:"list"`
	Total int64                    `json:"total"`
}

// FromConfigSnapshot converts repository metadata to the contract response.
func FromConfigSnapshot(item *repository.ConfigSnapshot) ConfigSnapshotResponse {
	details := json.RawMessage(item.ValidationDetails)
	if len(details) == 0 {
		details = json.RawMessage("{}")
	}
	return ConfigSnapshotResponse{
		ID:                item.ID,
		NetworkDomainID:   item.NetworkDomainID,
		Version:           item.Version,
		Checksum:          item.Checksum,
		ValidationStatus:  item.ValidationStatus,
		ValidationCause:   item.ValidationCause,
		ValidationDetails: details,
		IsCurrent:         item.IsCurrent,
		GeneratedBy:       item.GeneratedBy,
		CreatedAt:         item.CreatedAt,
	}
}
