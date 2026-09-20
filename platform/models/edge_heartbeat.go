// Package models 承载 MetricCenter 领域模型。
// 本文件定义 Module_11 边缘心跳与组件清单模型及枚举（EdgeHeartbeat /
// EdgeComponent / ComponentType / ComponentStatus），供后续 edge 协议层复用。
// 参见 docs/02-product-requirements/Modules/Module_11_Edge_Access_and_Agent_Delivery.md
//
//	§5.3（EdgeHeartbeat）/ §8.4（组件守护状态）。
package models

import "time"

// ComponentType 表示边缘组件类型（采集器 / 拨测器 / Agent 自身）。
type ComponentType string

// 组件类型常量。
const (
	ComponentTypeAgent     ComponentType = "agent"
	ComponentTypeCollector ComponentType = "collector"
	ComponentTypeBlackbox  ComponentType = "blackbox_exporter"
)

// ComponentStatus 表示边缘组件守护状态（PRD §8.4）。
type ComponentStatus string

// 组件守护状态常量。
const (
	ComponentStatusRunning     ComponentStatus = "running"
	ComponentStatusRestarting  ComponentStatus = "restarting"
	ComponentStatusCrashLoop   ComponentStatus = "crash_loop"
	ComponentStatusNotDeployed ComponentStatus = "not_deployed"
)

// EdgeComponent 表示单个边缘组件的运行态与守护扩展（PRD §5.3 components）。
// 单组件含 type / name / status / version / config_version / last_error，
// 守护扩展 restart_count / last_restart_at；status 含 restarting / crash_loop。
type EdgeComponent struct {
	Type          ComponentType   `json:"type"`
	Name          string          `json:"name"`
	Status        ComponentStatus `json:"status"`
	Version       string          `json:"version,omitempty"`
	ConfigVersion string          `json:"config_version,omitempty"`
	LastError     string          `json:"last_error,omitempty"`
	RestartCount  int             `json:"restart_count,omitempty"`
	LastRestartAt *time.Time      `json:"last_restart_at,omitempty"`
}

// EdgeHeartbeat 表示采集节点定时上报的心跳记录（PRD §5.3）。
// 仅作观测留痕；中心以接收时间写 EdgeAgent.last_heartbeat，本表 timestamp 仅供参考。
type EdgeHeartbeat struct {
	BaseModel
	NetworkDomainID      string          `gorm:"size:64;not null;index" json:"network_domain_id"`
	AgentType            AgentType       `gorm:"size:30;not null" json:"agent_type"` // 同网域登记值
	Version              string          `gorm:"size:50" json:"version,omitempty"`
	ConfigVersion        string          `gorm:"size:64" json:"config_version,omitempty"`                         // 中心据此判定 config_changed
	QueueBacklogBytes    int64           `gorm:"column:queue_backlog_bytes" json:"queue_backlog_bytes,omitempty"` // 磁盘持久发送队列积压字节数（决策 C5：采集器统一为 vmagent）
	RemoteWriteQueueSize int             `json:"remote_write_queue_size,omitempty"`
	RemoteWriteLastError string          `gorm:"type:text" json:"remote_write_last_error,omitempty"`
	Hostname             string          `gorm:"size:200" json:"hostname,omitempty"`
	Ip                   string          `gorm:"size:64" json:"ip,omitempty"`
	Components           []EdgeComponent `gorm:"serializer:json" json:"components,omitempty"`
	Timestamp            time.Time       `json:"timestamp"` // 上报时间，仅作参考
}

// TableName returns the GORM table name.
func (EdgeHeartbeat) TableName() string { return "edge_heartbeats" }
