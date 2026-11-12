package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// TargetResponse is one fused target row (contract §7.1).
type TargetResponse struct {
	Job           string     `json:"job"`
	Instance      string     `json:"instance"`
	NetworkDomain string     `json:"network_domain"`
	InstanceName  string     `json:"instance_name"`
	Health        string     `json:"health"`
	LastScrape    *time.Time `json:"last_scrape"`
	LastError     string     `json:"last_error"`
	Source        string     `json:"source"`
}

// ListTargetsResponse is the paginated targets envelope.
type ListTargetsResponse struct {
	List     []TargetResponse `json:"list"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

// CoverageResponse is the three-state coverage aggregate (contract §7.2).
type CoverageResponse struct {
	Collecting           int64 `json:"collecting"`
	DeployedNotCollected int64 `json:"deployed_not_collected"`
	NotMonitored         int64 `json:"not_monitored"`
}

// FromEdgeTarget converts an edge snapshot row to the contract representation.
func FromEdgeTarget(row *repository.EdgeTargetRow) TargetResponse {
	health := row.Health
	if health == "" {
		health = "unknown"
	}
	return TargetResponse{
		Job:           row.Job,
		Instance:      row.Instance,
		NetworkDomain: row.NetworkDomainID,
		InstanceName:  row.ResourceID,
		Health:        health,
		LastScrape:    row.LastScrape,
		LastError:     row.LastError,
		Source:        "edge",
	}
}
