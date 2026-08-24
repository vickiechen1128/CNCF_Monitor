package models

import (
	"time"

	"gorm.io/gorm"
)
// DomainType distinguishes a management domain from an edge domain.
type DomainType string

// Domain type constants.
const (
	DomainTypeManagement DomainType = "management"
	DomainTypeEdge       DomainType = "edge"
)

// DomainStatus is the administrative enabled/disabled status.
type DomainStatus string

// Domain status constants.
const (
	DomainStatusEnabled  DomainStatus = "enabled"
	DomainStatusDisabled DomainStatus = "disabled"
)

// ChannelType is the config delivery channel for a network domain.
type ChannelType string

// Channel type constants.
const (
	ChannelTypeLocal     ChannelType = "local"      // 中心同机写盘 reload
	ChannelTypeAgentPull ChannelType = "agent_pull" // Edge Sync Agent 心跳拉包
)

// AgentType is the edge collector type.
type AgentType string

// Agent type constants.
const (
	AgentTypeVMAgent           AgentType = "vmagent"
	AgentTypePrometheusAgent   AgentType = "prometheus-agent"
)

// DefaultDomainID is the historical pre-provisioned management domain id.
const DefaultDomainID = "default"

// NetworkDomain represents a network domain, combining Module_06 administrative
// fields and Module_09 monitoring-management fields (same table). ID is a
// business string primary key, generated as `<deploy_code>-<domain_code>` with
// `default` as the historical exception.
type NetworkDomain struct {
	ID                  string        `gorm:"primarykey;size:64" json:"id"`
	Name                string        `gorm:"size:100;not null" json:"name"`
	Description         string        `gorm:"size:500" json:"description"`
	DomainType          DomainType    `gorm:"size:20;not null" json:"domain_type"`
	ZoneType            string        `gorm:"size:50" json:"zone_type"`
	TenantID            string        `gorm:"size:64;not null" json:"tenant_id"` // 登记归属（创建后不可变更）
	AuthorizedTenantIDs []string      `gorm:"serializer:json" json:"authorized_tenant_ids"`
	CmdbCloudAreaID     string        `gorm:"size:100" json:"cmdb_cloud_area_id"`
	CmdbCloudAreaPath   string        `gorm:"size:500" json:"cmdb_cloud_area_path"`

	// Monitoring-management fields (Module_09).
	Channel         ChannelType `gorm:"size:20;not null" json:"channel"`
	Token           string      `gorm:"size:500" json:"-"`                              // agent_pull 时必填；仅服务端存取，不回显明文（token_masked 经 AfterFind 派生）
	TokenMaskedView string      `gorm:"-" json:"token_masked,omitempty"`                // 派生视图：完全脱敏的 token，不落库
	AgentType       AgentType   `gorm:"size:30" json:"agent_type,omitempty"`
	CenterEndpoint  string      `gorm:"size:500" json:"center_endpoint,omitempty"`
	RemoteWriteURL  string      `gorm:"size:500" json:"remote_write_url,omitempty"`
	MonitoredStatus string      `gorm:"size:20" json:"monitored_status,omitempty"` // online/offline/unknown（运行态）
	LastHeartbeat   *time.Time  `json:"last_heartbeat,omitempty"`
	AgentVersion    string      `gorm:"size:50" json:"agent_version,omitempty"`
	IsMonitored     bool        `json:"is_monitored"` // 已纳管监控标记（M09）

	Status    DomainStatus `gorm:"size:20;not null" json:"status"` // enabled/disabled（行政）
	CreatedAt time.Time    `json:"created_at"`
	UpdatedAt time.Time    `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// IsManagement reports whether the domain is a management (non-deletable) domain.
func (d *NetworkDomain) IsManagement() bool { return d.DomainType == DomainTypeManagement }

// AfterFind 在每次从库读出后派生 token_masked（完全脱敏），并确保不回显明文。
// 列表 / 详情（含 M06 网域列表）因此自动返回 token_masked 而非明文（契约 §3/§6.1）。
func (d *NetworkDomain) AfterFind(tx *gorm.DB) error {
	d.TokenMaskedView = TokenMasked(d.Token)
	return nil
}

// TableName returns the GORM table name for a NetworkDomain.
func (NetworkDomain) TableName() string { return "network_domains" }