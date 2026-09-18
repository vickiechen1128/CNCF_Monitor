package models

import "time"

// EdgeAgent represents an edge agent deployment (Edge Sync Agent + collector),
// aligned with Module_11 §5.2. MVP only models it; no runtime logic is
// implemented yet.
type EdgeAgent struct {
	BaseModel
	NetworkDomainID  string           `gorm:"size:64;not null;index" json:"network_domain_id"`
	AgentType        AgentType        `gorm:"size:30;not null" json:"agent_type"` // vmagent / prometheus-agent
	Version          string           `gorm:"size:50" json:"version,omitempty"`
	Hostname         string           `gorm:"size:200" json:"hostname,omitempty"`
	Ip               string           `gorm:"size:64" json:"ip,omitempty"`    // 出站 IP；中心以连接对端 IP 兜底校验
	Status           string           `gorm:"size:20;not null" json:"status"` // online/offline/unknown
	LastHeartbeat    *time.Time       `json:"last_heartbeat,omitempty"`
	HeartbeatRTTMs   int              `json:"heartbeat_rtt_ms,omitempty"`
	LastConfigPull   *time.Time       `json:"last_config_pull,omitempty"` // 以中心接收时间为准
	ConfigVersion    string           `gorm:"size:64" json:"config_version,omitempty"`
	ConfigSyncStatus ConfigSyncStatus `gorm:"size:30" json:"config_sync_status,omitempty"` // in_sync/out_of_sync/unknown/manual_override/no_version
	OutOfSyncCause   OutOfSyncCause   `gorm:"size:30" json:"out_of_sync_cause,omitempty"`  // pending_draft/pull_pending/local_reset
	CollectorStatus  string           `gorm:"size:30" json:"collector_status,omitempty"`
	CollectorVersion string           `gorm:"size:50" json:"collector_version,omitempty"`
	WalBacklogBytes  int64            `json:"wal_backlog_bytes,omitempty"`
	RemoteWriteURL   string           `gorm:"size:500" json:"remote_write_url,omitempty"`
	Components       []EdgeComponent  `gorm:"serializer:json" json:"components,omitempty"` // 组件清单（JSON 载体）
	LastError        string           `gorm:"type:text" json:"last_error,omitempty"`
}

// TableName returns the GORM table name.
func (EdgeAgent) TableName() string { return "edge_agents" }
