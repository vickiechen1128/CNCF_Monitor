package models

import "time"

// EdgeAgent represents an edge agent deployment (Edge Sync Agent + collector),
// aligned with Module_09 §5.2. MVP only models it; no runtime logic is
// implemented yet.
type EdgeAgent struct {
	BaseModel
	NetworkDomainID  string     `gorm:"size:64;not null;index" json:"network_domain_id"`
	AgentType        AgentType  `gorm:"size:30;not null" json:"agent_type"` // vmagent / prometheus-agent
	Version          string     `gorm:"size:50" json:"version,omitempty"`
	Hostname         string     `gorm:"size:200" json:"hostname,omitempty"`
	Status           string     `gorm:"size:20;not null" json:"status"` // online/offline/unknown
	LastHeartbeat    *time.Time `json:"last_heartbeat,omitempty"`
	HeartbeatRTTMs   int        `json:"heartbeat_rtt_ms,omitempty"`
	ConfigVersion    string     `gorm:"size:64" json:"config_version,omitempty"`
	ConfigSyncStatus string     `gorm:"size:30" json:"config_sync_status,omitempty"`
	CollectorStatus  string     `gorm:"size:30" json:"collector_status,omitempty"`
	CollectorVersion string     `gorm:"size:50" json:"collector_version,omitempty"`
	WalBacklogBytes  int64      `json:"wal_backlog_bytes,omitempty"`
	RemoteWriteURL   string     `gorm:"size:500" json:"remote_write_url,omitempty"`
	LastError        string     `gorm:"type:text" json:"last_error,omitempty"`
	Components       string     `gorm:"type:text" json:"components,omitempty"` // JSON 载体（组件清单）
}

// TableName returns the GORM table name.
func (EdgeAgent) TableName() string { return "edge_agents" }