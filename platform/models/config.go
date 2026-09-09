package models

import (
	"encoding/json"
	"strings"
	"time"

	"gorm.io/gorm"
)

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
	AlertmanagerYml string     `gorm:"type:text" json:"alertmanager_yml,omitempty"` // 决策 60：仅管理域 default scope
	TargetsFiles    string     `gorm:"type:text" json:"targets_files,omitempty"` // JSON 载体
	Metadata        string     `gorm:"type:text" json:"metadata,omitempty"`       // JSON 载体（含 checksum）
	Summary         string     `gorm:"size:1000" json:"summary,omitempty"`
	ChangeItems     string     `gorm:"type:text" json:"change_items,omitempty"` // JSON 载体
	Status          DraftStatus `gorm:"size:20;not null" json:"status"`
	ValidationStatus string   `gorm:"size:20;not null" json:"validation_status"` // passed/failed/pending/rejected
	ValidationMessage string  `gorm:"type:text" json:"validation_message,omitempty"` // 校验失败/待校验的具体说明
	ValidationCause  string   `gorm:"size:20" json:"validation_cause,omitempty"`     // user_config/platform_fault（决策 45-3）
	ValidationDetails string `gorm:"type:text" json:"validation_details,omitempty"`  // JSON 载体：[]ValidationDetail 结构化定位
	ConfirmedBy     string     `gorm:"size:100" json:"confirmed_by,omitempty"`
	ConfirmedAt     *time.Time `json:"confirmed_at,omitempty"`
}

// TableName returns the GORM table name.
func (ConfigDraft) TableName() string { return "config_drafts" }

// jsonCarrier 将可能为 JSON 文本的 DB 载体解析为结构化 JSON，供响应序列化使用。
// DB 中 targets_files / metadata / change_items 以 JSON 载体字符串存储（text 列），
// 但契约要求 API 面呈现为对象 / 数组（api-contract-snapshot §4）。此处反解析，
// 空串/非法载体返回 nil（在 Marshal 中输出 null，仍保留 omitempty 语义）。
func jsonCarrier(s string) *json.RawMessage {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	raw := json.RawMessage(s)
	return &raw
}

// timeOfNullable 将 gorm.DeletedAt 转 *time.Time（序列化用）。
func timeOfNullable(d gorm.DeletedAt) *time.Time {
	if !d.Valid {
		return nil
	}
	t := d.Time
	return &t
}

// MarshalJSON 将 ConfigDraft 序列化，JSON 载体字段以结构化对象 / 数组输出
// （而非 DB 中的 JSON 文本字符串），符合契约对 change_items / metadata /
// targets_files 的形态要求，避免前端按对象访问崩溃。
func (d ConfigDraft) MarshalJSON() ([]byte, error) {
	type draftView struct {
		ID               uint             `json:"id"`
		CreatedAt        time.Time        `json:"created_at"`
		UpdatedAt        time.Time        `json:"updated_at"`
		DeletedAt        *time.Time       `json:"deleted_at,omitempty"`
		NetworkDomainID  string           `json:"network_domain_id"`
		ChangeNo         string           `json:"change_no"`
		SourceVersion    string           `json:"source_version,omitempty"`
		PrometheusYml    string           `json:"prometheus_yml,omitempty"`
		RulesYml         string           `json:"rules_yml,omitempty"`
		BlackboxYml      string           `json:"blackbox_yml,omitempty"`
		AlertmanagerYml  string           `json:"alertmanager_yml,omitempty"`
		TargetsFiles     *json.RawMessage `json:"targets_files,omitempty"`
		Metadata         *json.RawMessage `json:"metadata,omitempty"`
		Summary          string           `json:"summary,omitempty"`
		ChangeItems      *json.RawMessage `json:"change_items,omitempty"`
		Status            DraftStatus      `json:"status"`
		ValidationStatus  string           `json:"validation_status"`
		ValidationMessage string           `json:"validation_message,omitempty"`
		ValidationCause   string           `json:"validation_cause,omitempty"`
		ValidationDetails *json.RawMessage `json:"validation_details,omitempty"`
		ConfirmedBy       string           `json:"confirmed_by,omitempty"`
		ConfirmedAt       *time.Time       `json:"confirmed_at,omitempty"`
	}
	return json.Marshal(draftView{
		ID:                d.ID,
		CreatedAt:         d.CreatedAt,
		UpdatedAt:         d.UpdatedAt,
		DeletedAt:         timeOfNullable(d.DeletedAt),
		NetworkDomainID:   d.NetworkDomainID,
		ChangeNo:          d.ChangeNo,
		SourceVersion:     d.SourceVersion,
		PrometheusYml:     d.PrometheusYml,
		RulesYml:          d.RulesYml,
		BlackboxYml:       d.BlackboxYml,
		AlertmanagerYml:   d.AlertmanagerYml,
		TargetsFiles:      jsonCarrier(d.TargetsFiles),
		Metadata:          jsonCarrier(d.Metadata),
		Summary:           d.Summary,
		ChangeItems:       jsonCarrier(d.ChangeItems),
		Status:            d.Status,
		ValidationStatus:  d.ValidationStatus,
		ValidationMessage: d.ValidationMessage,
		ValidationCause:   d.ValidationCause,
		ValidationDetails: jsonCarrier(d.ValidationDetails),
		ConfirmedBy:       d.ConfirmedBy,
		ConfirmedAt:       d.ConfirmedAt,
	})
}

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
	AlertmanagerYml string `gorm:"type:text" json:"alertmanager_yml,omitempty"` // 决策 60：仅管理域 default scope
	TargetsFiles    string `gorm:"type:text" json:"targets_files,omitempty"` // JSON 载体
	Metadata        string `gorm:"type:text" json:"metadata,omitempty"`       // JSON 载体（含 checksum）
}

// TableName returns the GORM table name.
func (ConfigVersion) TableName() string { return "config_versions" }

// MarshalJSON 将 ConfigVersion 序列化，targets_files / metadata 以结构化对象输出，
// 与 ConfigDraft 一致，供版本对比（diff）等前端对象访问逻辑使用。
func (v ConfigVersion) MarshalJSON() ([]byte, error) {
	type versionView struct {
		ID              uint             `json:"id"`
		CreatedAt       time.Time        `json:"created_at"`
		UpdatedAt       time.Time        `json:"updated_at"`
		DeletedAt       *time.Time       `json:"deleted_at,omitempty"`
		NetworkDomainID string           `json:"network_domain_id"`
		DraftID         string           `json:"draft_id"`
		ChangeNo        string           `json:"change_no"`
		PrometheusYml   string           `json:"prometheus_yml,omitempty"`
		RulesYml        string           `json:"rules_yml,omitempty"`
		BlackboxYml     string           `json:"blackbox_yml,omitempty"`
		AlertmanagerYml string           `json:"alertmanager_yml,omitempty"`
		TargetsFiles    *json.RawMessage `json:"targets_files,omitempty"`
		Metadata        *json.RawMessage `json:"metadata,omitempty"`
	}
	return json.Marshal(versionView{
		ID:              v.ID,
		CreatedAt:       v.CreatedAt,
		UpdatedAt:       v.UpdatedAt,
		DeletedAt:       timeOfNullable(v.DeletedAt),
		NetworkDomainID: v.NetworkDomainID,
		DraftID:         v.DraftID,
		ChangeNo:        v.ChangeNo,
		PrometheusYml:   v.PrometheusYml,
		RulesYml:        v.RulesYml,
		BlackboxYml:     v.BlackboxYml,
		AlertmanagerYml: v.AlertmanagerYml,
		TargetsFiles:    jsonCarrier(v.TargetsFiles),
		Metadata:        jsonCarrier(v.Metadata),
	})
}

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
	// DeploymentID 是面向 API/UI 的下发记录唯一标识，格式 deploy-YYYYMMDD-NNN。
	// 内部自增 ID 仍作为 DB 主键，但对外以 DeploymentID 为业务 ID。
	DeploymentID      string           `gorm:"size:64;uniqueIndex" json:"-"`
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

// VersionRef 是配置版本的轻量引用（用于回滚预览等场景）。
type VersionRef struct {
	ID       string `json:"id"`
	ChangeNo string `json:"change_no"`
}

// RollbackDiffItem 表示回滚预览中的单条源数据操作差异。
type RollbackDiffItem struct {
	Side          string   `json:"side"` // target / current / both
	Type          string   `json:"type"`
	Target        string   `json:"target"`
	Description   string   `json:"description"`
	AffectedFiles []string `json:"affected_files"`
	Risk          string   `json:"risk"`
}

// RollbackPreview 是回滚确认前的差异预览（决策 63 P0）。
type RollbackPreview struct {
	TargetVersion  VersionRef         `json:"target_version"`
	CurrentVersion *VersionRef        `json:"current_version,omitempty"`
	DiffItems      []RollbackDiffItem `json:"diff_items"`
	Warning        string             `json:"warning"`
}

// MarshalJSON 将 ConfigDeployment 序列化，对外暴露的业务 ID 为 DeploymentID（deploy-xxx），
// 隐藏内部自增主键，与契约 §5 / UI 展示名「部署 ID」保持一致。
func (d ConfigDeployment) MarshalJSON() ([]byte, error) {
	type deploymentView struct {
		ID               string           `json:"id"`
		NetworkDomainID  string           `json:"network_domain_id"`
		ConfigVersionID  string           `json:"config_version_id"`
		SourceChangeNo   string           `json:"source_change_no"`
		Channel          ChannelType      `json:"channel"`
		TargetAddress    string           `json:"target_address,omitempty"`
		Status           DeploymentStatus `json:"status"`
		ValidationStatus string           `json:"validation_status"`
		IncludesBlackbox bool             `json:"includes_blackbox"`
		ErrorMessage     string           `json:"error_message,omitempty"`
		TriggeredBy      string           `json:"triggered_by"`
		TriggeredAt      *time.Time       `json:"triggered_at,omitempty"`
		CompletedAt      *time.Time       `json:"completed_at,omitempty"`
		CreatedAt        time.Time        `json:"created_at"`
		UpdatedAt        time.Time        `json:"updated_at"`
	}
	return json.Marshal(deploymentView{
		ID:               d.DeploymentID,
		NetworkDomainID:  d.NetworkDomainID,
		ConfigVersionID:  d.ConfigVersionID,
		SourceChangeNo:   d.SourceChangeNo,
		Channel:          d.Channel,
		TargetAddress:    d.TargetAddress,
		Status:           d.Status,
		ValidationStatus: d.ValidationStatus,
		IncludesBlackbox: d.IncludesBlackbox,
		ErrorMessage:     d.ErrorMessage,
		TriggeredBy:      d.TriggeredBy,
		TriggeredAt:      d.TriggeredAt,
		CompletedAt:      d.CompletedAt,
		CreatedAt:        d.CreatedAt,
		UpdatedAt:        d.UpdatedAt,
	})
}