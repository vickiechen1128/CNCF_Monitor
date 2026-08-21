package models

import "time"

// DraftStatus represents the lifecycle status of a config draft.
type DraftStatus string

// Draft status constants.
const (
	DraftStatusPending   DraftStatus = "pending"
	DraftStatusConfirmed DraftStatus = "confirmed"
	DraftStatusDiscarded DraftStatus = "discarded"
)

// ConfigDraft holds a generated configuration draft awaiting confirmation,
// aligned with Module_09 §5.4.
type ConfigDraft struct {
	BaseModel
	NetworkDomainID string     `gorm:"size:64;not null;index" json:"network_domain_id"`
	ChangeNo        string     `gorm:"size:64;not null;uniqueIndex" json:"change_no"` // 如 CHG-20260803-003
	SourceVersion   string     `gorm:"size:64" json:"source_version,omitempty"`       // 基于哪个 ConfigVersion
	PrometheusYml   string     `gorm:"type:text" json:"prometheus_yml"`
	RulesYml        string     `gorm:"type:text" json:"rules_yml,omitempty"`
	BlackboxYml     string     `gorm:"type:text" json:"blackbox_yml,omitempty"`
	TargetsFiles    string     `gorm:"type:text" json:"targets_files,omitempty"` // JSON 载体
	Metadata        string     `gorm:"type:text" json:"metadata,omitempty"`       // JSON 载体（含 checksum）
	Summary         string     `gorm:"size:1000" json:"summary,omitempty"`
	ChangeItems     string     `gorm:"type:text" json:"change_items,omitempty"` // JSON 载体
	Status          DraftStatus `gorm:"size:20;not null" json:"status"`
	ValidationStatus string   `gorm:"size:20;not null" json:"validation_status"` // passed/failed/pending/rejected
	ConfirmedBy     string     `gorm:"size:100" json:"confirmed_by,omitempty"`
	ConfirmedAt     *time.Time `json:"confirmed_at,omitempty"`
}

// TableName returns the GORM table name.
func (ConfigDraft) TableName() string { return "config_drafts" }

// ConfigVersion is an immutable confirmed configuration snapshot per domain,
// aligned with Module_09 §5.5.
type ConfigVersion struct {
	BaseModel
	NetworkDomainID string `gorm:"size:64;not null;index" json:"network_domain_id"`
	DraftID         string `gorm:"size:64;not null" json:"draft_id"`
	ChangeNo        string `gorm:"size:64;not null" json:"change_no"`
	PrometheusYml   string `gorm:"type:text" json:"prometheus_yml"`
	RulesYml        string `gorm:"type:text" json:"rules_yml,omitempty"`
	BlackboxYml     string `gorm:"type:text" json:"blackbox_yml,omitempty"`
	TargetsFiles    string `gorm:"type:text" json:"targets_files,omitempty"` // JSON 载体
	Metadata        string `gorm:"type:text" json:"metadata,omitempty"`       // JSON 载体（含 checksum）
}

// TableName returns the GORM table name.
func (ConfigVersion) TableName() string { return "config_versions" }

// DeploymentStatus represents the status of a config deployment.
type DeploymentStatus string

// Deployment status constants.
const (
	DeploymentStatusPending    DeploymentStatus = "pending"
	DeploymentStatusRunning    DeploymentStatus = "running"
	DeploymentStatusSuccess    DeploymentStatus = "success"
	DeploymentStatusFailed     DeploymentStatus = "failed"
	DeploymentStatusRolledBack DeploymentStatus = "rolled_back"
)

// ConfigDeployment records a config delivery attempt, aligned with Module_09 §5.6.
type ConfigDeployment struct {
	BaseModel
	NetworkDomainID   string           `gorm:"size:64;not null;index" json:"network_domain_id"`
	ConfigVersionID   string           `gorm:"size:64;not null" json:"config_version_id"`
	SourceChangeNo    string           `gorm:"size:64;not null" json:"source_change_no"`
	Channel           ChannelType      `gorm:"size:20;not null" json:"channel"`
	TargetAddress     string           `gorm:"size:500" json:"target_address,omitempty"`
	Status            DeploymentStatus `gorm:"size:20;not null" json:"status"`
	ValidationStatus  string           `gorm:"size:20;not null" json:"validation_status"`
	IncludesBlackbox  bool             `json:"includes_blackbox"`
	ErrorMessage      string           `gorm:"type:text" json:"error_message,omitempty"`
	TriggeredBy       string           `gorm:"size:100;not null" json:"triggered_by"`
	TriggeredAt       *time.Time       `json:"triggered_at,omitempty"`
	CompletedAt       *time.Time       `json:"completed_at,omitempty"`
}

// TableName returns the GORM table name.
func (ConfigDeployment) TableName() string { return "config_deployments" }