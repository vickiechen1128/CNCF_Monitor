package domain

import (
	"fmt"
	"strings"
	"time"
)

// ProtocolVersionV1 is the only supported edge protocol version (contract §6).
const ProtocolVersionV1 = "v1"

// SupportedProtocolVersions lists the accepted protocol versions for error text.
const SupportedProtocolVersions = ProtocolVersionV1

// Component status constants (contract §8.4). The agent may also report
// "unknown" for a component whose state cannot be determined.
const (
	ComponentStatusRunning     = "running"
	ComponentStatusRestarting  = "restarting"
	ComponentStatusCrashLoop   = "crash_loop"
	ComponentStatusNotDeployed = "not_deployed"
	ComponentStatusUnknown     = "unknown"
)

// Edge agent status constants (contract §8.2). retired is terminal.
const (
	EdgeAgentStatusOnline  = "online"
	EdgeAgentStatusOffline = "offline"
	EdgeAgentStatusUnknown = "unknown"
	EdgeAgentStatusRetired = "retired"
)

// Component describes one supervised process on an edge node.
type Component struct {
	Type          string `json:"type"`
	Name          string `json:"name"`
	Status        string `json:"status"`
	Version       string `json:"version,omitempty"`
	ConfigVersion string `json:"config_version,omitempty"`
	RestartCount  int64  `json:"restart_count,omitempty"`
	LastRestartAt string `json:"last_restart_at,omitempty"`
	LastError     string `json:"last_error,omitempty"`
}

// TargetSnapshot is the latest scrape state of one edge target (F-11).
type TargetSnapshot struct {
	Job                   string  `json:"job"`
	Instance              string  `json:"instance"`
	ResourceID            string  `json:"resource_id,omitempty"`
	Health                string  `json:"health"`
	LastScrape            string  `json:"last_scrape,omitempty"`
	LastError             string  `json:"last_error,omitempty"`
	ScrapeDurationSeconds float64 `json:"scrape_duration_seconds,omitempty"`
}

// HeartbeatRequest is the POST /api/v3/edge/heartbeat body (contract §6.1).
// NetworkDomainID is accepted for backward compatibility but ignored: the
// domain is always derived from the edge token (D27).
type HeartbeatRequest struct {
	ProtocolVersion string `json:"protocol_version,omitempty"`
	NetworkDomainID string `json:"network_domain_id,omitempty"`

	AgentType     string `json:"agent_type,omitempty"`
	Version       string `json:"version,omitempty"`
	ConfigVersion string `json:"config_version,omitempty"`
	Hostname      string `json:"hostname"`
	IP            string `json:"ip,omitempty"`

	Components []Component `json:"components,omitempty"`

	QueueBacklogBytes       int64 `json:"queue_backlog_bytes,omitempty"`
	RemoteWriteQueueSize    int64 `json:"remote_write_queue_size,omitempty"`
	RemoteWriteDroppedTotal int64 `json:"remote_write_dropped_total,omitempty"`
	RemoteWriteRetriesTotal int64 `json:"remote_write_retries_total,omitempty"`

	RemoteWriteLastError string `json:"remote_write_last_error,omitempty"`

	TargetsCollected bool             `json:"targets_collected,omitempty"`
	Targets          []TargetSnapshot `json:"targets,omitempty"`

	MetadataRemoteWriteURL     string `json:"metadata_remote_write_url,omitempty"`
	MetadataMaxDiskUsagePerURL string `json:"metadata_max_disk_usage_per_url,omitempty"`

	ConfigApplyError         string `json:"config_apply_error,omitempty"`
	ConfigApplyFailedVersion string `json:"config_apply_failed_version,omitempty"`

	Timestamp *time.Time `json:"timestamp,omitempty"`
}

// HeartbeatResponse is the heartbeat reply (contract §6.1). Config fields are
// populated once config sync (B5) publishes a current snapshot.
type HeartbeatResponse struct {
	ConfigChanged     bool      `json:"config_changed"`
	ConfigVersion     string    `json:"config_version"`
	ConfigChecksum    string    `json:"config_checksum,omitempty"`
	ConfigDownloadURL string    `json:"config_download_url,omitempty"`
	VMAgentRestartSeq int64     `json:"vm_agent_restart_seq"`
	FlushBacklogSeq   int64     `json:"flush_backlog_seq"`
	ParamsChanged     bool      `json:"params_changed,omitempty"`
	ServerTime        time.Time `json:"server_time"`
}

// ValidateProtocol rejects unsupported protocol versions. An empty version is
// treated as v1 so older agents keep working during the migration window.
func ValidateProtocol(raw string) error {
	value := strings.TrimSpace(raw)
	if value == "" || value == ProtocolVersionV1 {
		return nil
	}
	return &ValidationError{Field: "protocol_version", Message: fmt.Sprintf(
		"unsupported protocol_version %q (supported: %s)", raw, SupportedProtocolVersions)}
}

// SyncStatus derives the config_sync_status / out_of_sync_cause pair from the
// reported config version and the domain's current published version.
func SyncStatus(reportedVersion, currentVersion, applyError string) (status, cause string) {
	if strings.TrimSpace(applyError) != "" {
		return "out_of_sync", "apply_failed"
	}
	reported := strings.TrimSpace(reportedVersion)
	current := strings.TrimSpace(currentVersion)
	switch {
	case reported == "":
		return "no_version", ""
	case current == "":
		return "unknown", ""
	case reported == current:
		return "in_sync", ""
	default:
		return "out_of_sync", "pull_pending"
	}
}

// EffectiveAgentStatus derives the display status from the stored status and
// the last heartbeat time (FR-06). A node whose heartbeat is older than the
// threshold is shown as offline even if the stored column still says online.
func EffectiveAgentStatus(stored string, lastHeartbeat *time.Time, now time.Time, threshold time.Duration) string {
	if stored == EdgeAgentStatusRetired {
		return EdgeAgentStatusRetired
	}
	if lastHeartbeat == nil {
		return EdgeAgentStatusUnknown
	}
	if threshold > 0 && now.Sub(*lastHeartbeat) > threshold {
		return EdgeAgentStatusOffline
	}
	return stored
}
