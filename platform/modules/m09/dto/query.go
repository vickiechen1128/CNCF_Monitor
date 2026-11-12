package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
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

// CoverageItemResponse is one resource's collection state (contract §7.2).
type CoverageItemResponse struct {
	ResourceID       string  `json:"resource_id"`
	ResourceCategory string  `json:"resource_category"`
	InstanceName     string  `json:"instance_name"`
	MonitorState     string  `json:"monitor_state"`
	Health           *string `json:"health"`
	LastError        string  `json:"last_error"`
}

// CoverageSummaryResponse aggregates the per-resource states (contract §7.2).
type CoverageSummaryResponse struct {
	Total             int64   `json:"total"`
	Collecting        int64   `json:"collecting"`
	PartialCollecting int64   `json:"partial_collecting"`
	PendingDown       int64   `json:"pending_down"`
	NotMonitored      int64   `json:"not_monitored"`
	CoverageRate      float64 `json:"coverage_rate"`
}

// CoverageResponse is the coverage page (contract §7.2). The three top-level
// counters are kept for compatibility with the M07 badge consumer.
type CoverageResponse struct {
	Items                []CoverageItemResponse  `json:"items"`
	Total                int64                   `json:"total"`
	Summary              CoverageSummaryResponse `json:"summary"`
	Collecting           int64                   `json:"collecting"`
	DeployedNotCollected int64                   `json:"deployed_not_collected"`
	NotMonitored         int64                   `json:"not_monitored"`
}

// FromCoverageReport converts the service report to the contract response.
func FromCoverageReport(report service.CoverageReport, counts service.CoverageCounts) CoverageResponse {
	items := make([]CoverageItemResponse, 0, len(report.Items))
	for _, item := range report.Items {
		items = append(items, CoverageItemResponse{
			ResourceID:       item.ResourceID,
			ResourceCategory: item.ResourceCategory,
			InstanceName:     item.InstanceName,
			MonitorState:     item.MonitorState,
			Health:           item.Health,
			LastError:        item.LastError,
		})
	}
	return CoverageResponse{
		Items: items,
		Total: report.Total,
		Summary: CoverageSummaryResponse{
			Total:             report.Summary.Total,
			Collecting:        report.Summary.Collecting,
			PartialCollecting: report.Summary.PartialCollecting,
			PendingDown:       report.Summary.PendingDown,
			NotMonitored:      report.Summary.NotMonitored,
			CoverageRate:      report.Summary.CoverageRate,
		},
		Collecting:           counts.Collecting,
		DeployedNotCollected: counts.DeployedNotCollected,
		NotMonitored:         counts.NotMonitored,
	}
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
