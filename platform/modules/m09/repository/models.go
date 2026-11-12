package repository

import "time"

// accessRecord maps network_domain_access (1:1 with network_domains). The
// physical column names follow 00005_m09_edge_platform.
type accessRecord struct {
	DomainID           string     `gorm:"column:domain_id;primaryKey"`
	TokenHash          string     `gorm:"column:token_hash"`
	TokenMasked        string     `gorm:"column:token_masked"`
	TokenCreatedAt     *time.Time `gorm:"column:token_created_at"`
	RemoteWriteURL     string     `gorm:"column:remote_write_url"`
	CenterEndpoint     string     `gorm:"column:center_endpoint"`
	MaxDiskUsagePerURL string     `gorm:"column:max_disk_usage_per_url"`
	RegistrationStatus string     `gorm:"column:registration_status"`
	MonitoredAt        *time.Time `gorm:"column:monitored_at"`
	LastHeartbeatAt    *time.Time `gorm:"column:last_heartbeat_at"`
	LastConfigVersion  string     `gorm:"column:last_config_version"`
	CreatedAt          time.Time  `gorm:"column:created_at"`
	UpdatedAt          time.Time  `gorm:"column:updated_at"`
}

// TableName returns the v3 onboarding table.
func (accessRecord) TableName() string { return "network_domain_access" }

// domainOnboardingRow is the joined read row for the onboarding list/detail
// view: M06 administrative fields + M09 access state + edge-agent aggregates.
type domainOnboardingRow struct {
	DomainID                string     `gorm:"column:domain_id"`
	Name                    string     `gorm:"column:name"`
	Description             string     `gorm:"column:description"`
	CloudCode               string     `gorm:"column:cloud_code"`
	ZoneType                string     `gorm:"column:zone_type"`
	TenantID                string     `gorm:"column:tenant_id"`
	AuthorizedTenantIDsJSON string     `gorm:"column:authorized_tenant_ids_json"`
	AdminStatus             string     `gorm:"column:admin_status"`
	AdminDomainType         string     `gorm:"column:admin_domain_type"`
	RegistrationStatus      string     `gorm:"column:registration_status"`
	MonitoredAt             *time.Time `gorm:"column:monitored_at"`
	TokenMasked             string     `gorm:"column:token_masked"`
	AgentCount              int64      `gorm:"column:agent_count"`
	OnlineAgentCount        int64      `gorm:"column:online_agent_count"`
	LastHeartbeatAt         *time.Time `gorm:"column:last_heartbeat_at"`
	LastConfigVersion       string     `gorm:"column:last_config_version"`
	CenterEndpoint          string     `gorm:"column:center_endpoint"`
	RemoteWriteURL          string     `gorm:"column:remote_write_url"`
	CreatedAt               time.Time  `gorm:"column:created_at"`
	UpdatedAt               time.Time  `gorm:"column:updated_at"`
}
