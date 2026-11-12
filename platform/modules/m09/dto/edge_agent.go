package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// EdgeAgentResponse is the edge-agent view (contract §3.1).
type EdgeAgentResponse struct {
	ID                         int64              `json:"id"`
	NetworkDomainID            string             `json:"network_domain_id"`
	Hostname                   string             `json:"hostname"`
	IP                         string             `json:"ip"`
	AgentType                  string             `json:"agent_type"`
	Version                    string             `json:"version"`
	Status                     string             `json:"status"`
	LastHeartbeatAt            *time.Time         `json:"last_heartbeat_at"`
	HeartbeatRTTMs             int64              `json:"heartbeat_rtt_ms"`
	ConfigVersion              string             `json:"config_version"`
	ConfigSyncStatus           string             `json:"config_sync_status"`
	OutOfSyncCause             string             `json:"out_of_sync_cause"`
	ConfigApplyError           string             `json:"config_apply_error"`
	CollectorStatus            string             `json:"collector_status"`
	CollectorVersion           string             `json:"collector_version"`
	Components                 []domain.Component `json:"components"`
	QueueBacklogBytes          int64              `json:"queue_backlog_bytes"`
	RemoteWriteDroppedTotal    int64              `json:"remote_write_dropped_total"`
	RemoteWriteRetriesTotal    int64              `json:"remote_write_retries_total"`
	RemoteWriteLastError       string             `json:"remote_write_last_error"`
	MetadataRemoteWriteURL     string             `json:"metadata_remote_write_url"`
	MetadataMaxDiskUsagePerURL string             `json:"metadata_max_disk_usage_per_url"`
	VMAgentRestartSeq          int64              `json:"vm_agent_restart_seq"`
	RestartRequestedBy         string             `json:"restart_requested_by"`
	RestartRequestedAt         *time.Time         `json:"restart_requested_at"`
	FlushBacklogSeq            int64              `json:"flush_backlog_seq"`
	FlushRequestedBy           string             `json:"flush_requested_by"`
	FlushRequestedAt           *time.Time         `json:"flush_requested_at"`
	LastError                  string             `json:"last_error"`
	CreatedAt                  time.Time          `json:"created_at"`
	UpdatedAt                  time.Time          `json:"updated_at"`
}

// ListEdgeAgentsResponse is the pagination envelope for edge agents.
type ListEdgeAgentsResponse struct {
	List     []EdgeAgentResponse `json:"list"`
	Total    int64               `json:"total"`
	Page     int                 `json:"page"`
	PageSize int                 `json:"page_size"`
}

// EdgeAgentCommandResponse reports the resulting command sequence.
type EdgeAgentCommandResponse struct {
	ID                int64 `json:"id"`
	VMAgentRestartSeq int64 `json:"vm_agent_restart_seq,omitempty"`
	FlushBacklogSeq   int64 `json:"flush_backlog_seq,omitempty"`
}

// FromEdgeAgent converts the repository view to the contract response.
func FromEdgeAgent(view *repository.EdgeAgentView) EdgeAgentResponse {
	components := view.Components
	if components == nil {
		components = []domain.Component{}
	}
	return EdgeAgentResponse{
		ID:                         view.ID,
		NetworkDomainID:            view.NetworkDomainID,
		Hostname:                   view.Hostname,
		IP:                         view.IP,
		AgentType:                  view.AgentType,
		Version:                    view.Version,
		Status:                     view.Status,
		LastHeartbeatAt:            view.LastHeartbeatAt,
		HeartbeatRTTMs:             view.HeartbeatRTTMs,
		ConfigVersion:              view.ConfigVersion,
		ConfigSyncStatus:           view.ConfigSyncStatus,
		OutOfSyncCause:             view.OutOfSyncCause,
		ConfigApplyError:           view.ConfigApplyError,
		CollectorStatus:            view.CollectorStatus,
		CollectorVersion:           view.CollectorVersion,
		Components:                 components,
		QueueBacklogBytes:          view.QueueBacklogBytes,
		RemoteWriteDroppedTotal:    view.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal:    view.RemoteWriteRetriesTotal,
		RemoteWriteLastError:       view.RemoteWriteLastError,
		MetadataRemoteWriteURL:     view.MetadataRemoteWriteURL,
		MetadataMaxDiskUsagePerURL: view.MetadataMaxDiskUsagePerURL,
		VMAgentRestartSeq:          view.VMAgentRestartSeq,
		RestartRequestedBy:         view.RestartRequestedBy,
		RestartRequestedAt:         view.RestartRequestedAt,
		FlushBacklogSeq:            view.FlushBacklogSeq,
		FlushRequestedBy:           view.FlushRequestedBy,
		FlushRequestedAt:           view.FlushRequestedAt,
		LastError:                  view.LastError,
		CreatedAt:                  view.CreatedAt,
		UpdatedAt:                  view.UpdatedAt,
	}
}
