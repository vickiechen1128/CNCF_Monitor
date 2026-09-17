package models

import "time"

// 本文件定义 Module_06（多租户 / 用户管理）与 Module_03（轻量认证）的 MVP
// 用户认证模型：User / Session / LoginLog。
// 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md §5.3/§5.4
// 与 docs/02-product-requirements/Modules/Module_03_Gateway_and_Auth.md §4.0。

// UserStatus represents the lifecycle status of a user account.
type UserStatus string

// User status constants, aligned with Module_06 §5.3.
const (
	UserStatusActive   UserStatus = "active"
	UserStatusDisabled UserStatus = "disabled"
)

// 用户角色常量（决策 44：MVP 无角色/权限点体系，仅两级——平台管理员与普通用户）。
// 供 H-2 RequireAdmin 最小授权门判定「是否管理员」时比对结构体 Role 字段使用。
const (
	// UserRoleAdmin 为平台管理员（唯一可访问管理接口 /users*、/tenants* 等）。
	UserRoleAdmin = "admin"
	// UserRoleUser 为普通用户（不含任何管理接口授权）。
	UserRoleUser = "user"
)

// SessionTTL is the server-side session lifetime (12 hours), aligned with
// Module_03 §4.0. Sessions also become invalid on logout, password change,
// or when the owning user is disabled.
const SessionTTL = 12 * time.Hour

// User represents a platform login account, aligned with Module_06 §5.3.
// MVP fixes TenantID to platform_admin; role is two-level (admin / user,
// 决策 44). PasswordHash must never be serialized to JSON.
type User struct {
	ID           string     `gorm:"primarykey;size:64" json:"id"`
	TenantID     string     `gorm:"size:64;not null;index" json:"tenant_id"` // MVP 固定 platform_admin
	Username     string     `gorm:"size:64;not null;uniqueIndex" json:"username"`
	PasswordHash string     `gorm:"size:100;not null" json:"-"` // bcrypt 哈希，禁止任何接口/日志输出
	DisplayName  string     `gorm:"size:100;not null" json:"display_name"`
	Role         string     `gorm:"size:20;not null;default:'user'" json:"role"` // admin / user（决策 44）
	Status       UserStatus `gorm:"size:20;not null" json:"status"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
	DeletedAt    *time.Time `json:"deleted_at,omitempty"`
}

// TableName returns the GORM table name for a User.
func (User) TableName() string { return "users" }

// Session represents a server-side opaque-token login session, aligned with
// Module_03 §4.0. The token is an opaque random string; validity is governed
// by ExpiresAt (issued with SessionTTL) plus explicit invalidation on logout,
// password change, or user disablement.
type Session struct {
	ID        string    `gorm:"primarykey;size:64" json:"id"`
	Token     string    `gorm:"size:128;not null;uniqueIndex" json:"token"` // 不透明随机串
	UserID    string    `gorm:"size:64;not null;index" json:"user_id"`
	ExpiresAt time.Time `gorm:"not null;index" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TableName returns the GORM table name for a Session.
func (Session) TableName() string { return "sessions" }

// LoginLog represents one login attempt record (success or failure), aligned
// with Module_06 §5.4. Message carries the failure reason for diagnostics;
// it must never contain the plaintext password or its hash.
type LoginLog struct {
	ID        string    `gorm:"primarykey;size:64" json:"id"`
	Username  string    `gorm:"size:64;not null;index" json:"username"` // 含失败尝试
	Success   bool      `gorm:"not null" json:"success"`
	IP        string    `gorm:"size:64" json:"ip,omitempty"`
	Message   string    `gorm:"size:200" json:"message,omitempty"` // 失败原因，不含明文/哈希
	CreatedAt time.Time `gorm:"index" json:"created_at"`
}

// TableName returns the GORM table name for a LoginLog.
func (LoginLog) TableName() string { return "login_logs" }
