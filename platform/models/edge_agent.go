package models

import (
	"errors"
	"time"
)

// EdgeAgent status constants (决策 82-1：新增 retired 终态)
const (
	EdgeAgentStatusOnline  = "online"
	EdgeAgentStatusOffline = "offline"
	EdgeAgentStatusUnknown = "unknown"
	EdgeAgentStatusRetired = "retired" // 终态：已退场，保留供审计追溯
)

// IsValidEdgeAgentStatus checks if the status is valid
func IsValidEdgeAgentStatus(status string) bool {
	switch status {
	case EdgeAgentStatusOnline, EdgeAgentStatusOffline, EdgeAgentStatusUnknown, EdgeAgentStatusRetired:
		return true
	}
	return false
}

// CanTransitionToEdgeAgentStatus validates status transition (retired is terminal)
func CanTransitionToEdgeAgentStatus(from, to string) error {
	if from == EdgeAgentStatusRetired {
		return errors.New("retired is a terminal status, cannot transition")
	}
	if !IsValidEdgeAgentStatus(to) {
		return errors.New("invalid target status")
	}
	return nil
}

// EdgeAgent represents an edge agent deployment (Edge Sync Agent + collector),
// aligned with Module_11 §5.2. MVP only models it; no runtime logic is
// implemented yet.
type EdgeAgent struct {
	BaseModel
	NetworkDomainID  string           `gorm:"size:64;not null;index" json:"network_domain_id"`
	AgentType        AgentType        `gorm:"size:30;not null" json:"agent_type"` // 采集器统一为 vmagent（决策 C4）
	Version          string           `gorm:"size:50" json:"version,omitempty"`
	Hostname         string           `gorm:"size:200" json:"hostname,omitempty"`
	Ip               string           `gorm:"size:64" json:"ip,omitempty"`    // 出站 IP；中心以连接对端 IP 兜底校验
	Status           string           `gorm:"size:20;not null" json:"status"` // online/offline/unknown/retired（决策 82-1 retired 终态）
	LastHeartbeat    *time.Time       `json:"last_heartbeat,omitempty"`
	HeartbeatRTTMs   int              `json:"heartbeat_rtt_ms,omitempty"`
	LastConfigPull   *time.Time       `json:"last_config_pull,omitempty"` // 以中心接收时间为准
	ConfigVersion    string           `gorm:"size:64" json:"config_version,omitempty"`
	ConfigSyncStatus ConfigSyncStatus `gorm:"size:30" json:"config_sync_status,omitempty"` // in_sync/out_of_sync/unknown/manual_override/no_version
	OutOfSyncCause   OutOfSyncCause   `gorm:"size:30" json:"out_of_sync_cause,omitempty"`  // pending_draft/pull_pending/local_reset/apply_failed
	// ConfigApplyError 是最近一次配置应用失败原因（Agent 随心跳上报，应用成功后清空）。
	// 决策 3：新增专用字段而非复用语义过泛的 LastError（M11 设计提案 D-2）。
	ConfigApplyError         string `gorm:"type:text" json:"config_apply_error,omitempty"`
	ConfigApplyFailedVersion string `gorm:"size:64" json:"config_apply_failed_version,omitempty"` // 应用失败的配置版本
	CollectorStatus          string `gorm:"size:30" json:"collector_status,omitempty"`
	CollectorVersion         string `gorm:"size:50" json:"collector_version,omitempty"`
	QueueBacklogBytes        int64  `gorm:"column:queue_backlog_bytes" json:"queue_backlog_bytes,omitempty"`
	// RemoteWriteDroppedTotal / RemoteWriteRetriesTotal 是 vmagent remote_write 累计
	// 丢块+丢包总数 / 累计重试次数（F-39，Agent 随心跳上报并在此持久化最新值）。
	RemoteWriteDroppedTotal int64  `json:"remote_write_dropped_total,omitempty"`
	RemoteWriteRetriesTotal int64  `json:"remote_write_retries_total,omitempty"`
	RemoteWriteLastError    string `gorm:"type:text" json:"remote_write_last_error,omitempty"`
	RemoteWriteURL          string `gorm:"size:500" json:"remote_write_url,omitempty"`
	// MetadataRemoteWriteURL / MetadataMaxDiskUsagePerURL 是 Agent 心跳上报的当前
	// 生效配置目录 metadata.json 回传参数指纹（F-42）：镜像落盘供节点详情展示
	// 「节点当前生效回传参数」，并与网域配置比对驱动 params_changed 强制拉包。
	// 空 = Agent 未拉过包或版本较旧未上报。
	MetadataRemoteWriteURL     string `gorm:"size:500" json:"metadata_remote_write_url,omitempty"`
	MetadataMaxDiskUsagePerURL string `gorm:"size:32" json:"metadata_max_disk_usage_per_url,omitempty"`
	// VMAgentRestartSeq 是人工滚动重启 vmagent 采集子进程的幂等指令位（F-42 seq
	// 简化机制）：管理端点每次触发 +1，心跳响应透传最新值，Agent 本地持久化已执行
	// seq、发现更大值时幂等执行（重复心跳不重复重启）。无 pending/回报状态机，
	// 重启效果靠组件状态/积压/回传延迟列自然反映。
	VMAgentRestartSeq  int64           `json:"vm_agent_restart_seq,omitempty"`
	RestartRequestedBy string          `gorm:"size:64" json:"restart_requested_by,omitempty"` // 最近的触发人（审计留痕）
	RestartRequestedAt *time.Time      `json:"restart_requested_at,omitempty"`                // 最近的触发时间
	Components         []EdgeComponent `gorm:"serializer:json" json:"components,omitempty"`   // 组件清单（JSON 载体）
	LastError          string          `gorm:"type:text" json:"last_error,omitempty"`
}

// TableName returns the GORM table name.
func (EdgeAgent) TableName() string { return "edge_agents" }
