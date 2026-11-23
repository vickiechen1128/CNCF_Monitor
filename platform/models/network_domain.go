package models

import (
	"time"

	"gorm.io/gorm"
)

// DomainType is the v3 network-domain type. The center-direct management type
// was removed (M06 SRS v1.5 / D16): every network domain is served by a
// collection node.
type DomainType string

// Domain type constants.
const (
	DomainTypeEdge DomainType = "edge"
)

// DomainStatus is the administrative enabled/disabled status.
type DomainStatus string

// Domain status constants.
const (
	DomainStatusEnabled  DomainStatus = "enabled"
	DomainStatusDisabled DomainStatus = "disabled"
)

// ChannelType is the config delivery channel for a network domain. V3 removed
// the center-local channel together with the management domain type; every
// domain receives its config through the Edge Sync Agent.
type ChannelType string

// Channel type constants.
const (
	ChannelTypeAgentPull ChannelType = "agent_pull" // Edge Sync Agent 心跳拉包
)

// AgentType is the edge collector type.
type AgentType string

// Agent type constants（决策 C4：采集器强制单一 vmagent，已收敛 prometheus-agent）。
const (
	AgentTypeVMAgent AgentType = "vmagent"
)

// RegistrationStatus 表示网域纳管状态（PRD Module_11 §8.3）。
type RegistrationStatus string

// 纳管状态常量。
const (
	RegistrationStatusCreated   RegistrationStatus = "created"   // 未纳管，未建立监控接入身份
	RegistrationStatusMonitored RegistrationStatus = "monitored" // 已纳管，心跳 / 拉包生效中
	RegistrationStatusRetired   RegistrationStatus = "retired"   // 删除-级联清退终态（供审计）
)

// NetworkDomain represents the v3 administrative columns of `network_domains`.
// Runtime onboarding fields (token / channel / heartbeats / registration
// status) live in `network_domain_access` (M09) and were dropped from this
// table by migration 0014. Keeping only the administrative columns also keeps
// GORM writes aligned with the schema.
type NetworkDomain struct {
	ID          string     `gorm:"primarykey;size:64" json:"id"`
	Name        string     `gorm:"size:100;not null" json:"name"`
	Description string     `gorm:"size:500" json:"description"`
	DomainType  DomainType `gorm:"size:20;not null" json:"domain_type"`
	// ZoneType is retained only for legacy v2 rows. v3 removed the
	// network-partition feature (M06 SRS v1.3): v3 repositories never read or
	// write this column and config generation no longer injects zone labels.
	ZoneType string `gorm:"size:50" json:"zone_type,omitempty"`
	// CloudCode 是 cloud/network_domain 两标签中 cloud 标签的权威来源（决策 103
	// scheme-B）：登记时必填且须引用已启用云字典条目，创建后不可变更（与 TenantID
	// 同语义）。资源侧 cloud_code 不再落资源表，统一经 network_domain_id 派生。
	CloudCode           string   `gorm:"size:50" json:"cloud_code"`
	TenantID            string   `gorm:"size:64;not null" json:"tenant_id"` // 登记归属（创建后不可变更）
	AuthorizedTenantIDs []string `gorm:"serializer:json" json:"authorized_tenant_ids"`
	IPCIDRs             []string `gorm:"column:ip_c_id_rs;serializer:json" json:"ip_cidrs"` // 网段（CIDR）；资源导入时按 IP 自动推导网域归属
	// 物理列名 ip_c_id_rs 是 GORM 对 IPCIDRs 的历史推导结果（v2 库已存在该列），
	// 显式标注以免命名策略变化导致新增列；v3 首版 baseline 沿用同一物理名，
	// 待 v3 自有网域模型落地时再用 migration 改名（D5）。
	CmdbCloudAreaID   string `gorm:"size:100" json:"cmdb_cloud_area_id"`
	CmdbCloudAreaPath string `gorm:"size:500" json:"cmdb_cloud_area_path"`

	Status    DomainStatus   `gorm:"size:20;not null" json:"status"` // enabled/disabled（行政）
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// TableName returns the GORM table name for a NetworkDomain.
func (NetworkDomain) TableName() string { return "network_domains" }
