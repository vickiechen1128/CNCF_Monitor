package models

import "time"

// TenantStatus represents the lifecycle status of a tenant.
type TenantStatus string

// Tenant status constants.
const (
	TenantStatusActive    TenantStatus = "active"
	TenantStatusSuspended TenantStatus = "suspended"
	TenantStatusDisabled  TenantStatus = "disabled"
)

// PlatformAdminTenantID is the fixed pre-provisioned platform tenant id.
const PlatformAdminTenantID = "platform_admin"

// Tenant represents an isolation / permission scope unit, aligned with
// Module_06 §5.1. Its ID is a business string primary key (e.g. platform_admin).
type Tenant struct {
	ID                string       `gorm:"primarykey;size:64" json:"id"`
	Name              string       `gorm:"size:100;not null" json:"name"`
	NetworkDomainIDs  []string     `gorm:"serializer:json" json:"network_domain_ids"` // 被授权网域（授权 ≠ 拥有）
	MultiSiteEnabled  bool         `json:"multi_site_enabled"`
	IsPlatformAdmin   bool         `json:"is_platform_admin"`
	Status            TenantStatus `gorm:"size:20;not null" json:"status"`
	CreatedAt         time.Time    `json:"created_at"`
	UpdatedAt         time.Time    `json:"updated_at"`
	DeletedAt         *time.Time   `json:"deleted_at,omitempty"`
}

// TableName returns the GORM table name for a Tenant.
func (Tenant) TableName() string { return "tenants" }