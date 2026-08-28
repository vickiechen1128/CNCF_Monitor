// Package seed 的 admin.go 实现 Module_06（多租户 / 用户管理）初始管理员种子
// — 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md §5.3/§9.2。
package seed

import (
	"errors"
	"fmt"
	"os"

	"github.com/metriccenter/metriccenter/platform/models"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// 初始管理员种子常量（Module_06 §5.3「初始管理员」）。
const (
	// AdminUserID is the fixed primary key of the seeded initial admin user.
	AdminUserID = "admin"
	// AdminUsername is the login name of the seeded initial admin user.
	AdminUsername = "admin"
	// AdminPasswordEnv is the deployment configuration item (environment
	// variable, consistent with METRIC_CENTER_DB_DSN / CONFIG_* style in
	// platform/cmd/metric-center/main.go) carrying the initial admin password.
	AdminPasswordEnv = "METRIC_CENTER_ADMIN_PASSWORD"
	// DefaultAdminPassword is the initial admin password used when
	// AdminPasswordEnv is not configured. 首次登录后应引导改密。
	DefaultAdminPassword = "admin123"
)

// runAdminUser upserts the initial admin user, aligned with Module_06 §5.3 /
// §9.2: idempotent, an existing admin row is left untouched (存在即跳过), so a
// password changed after first boot is never reset by re-seeding.
func runAdminUser(db *gorm.DB) error {
	var existing models.User
	err := db.Where("username = ?", AdminUsername).First(&existing).Error
	if err == nil {
		return nil // 已存在：跳过重置，保留已修改的密码
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("query admin user: %w", err)
	}

	password := os.Getenv(AdminPasswordEnv)
	if password == "" {
		password = DefaultAdminPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash admin password: %w", err)
	}

	user := &models.User{
		ID:           AdminUserID,
		TenantID:     models.PlatformAdminTenantID, // MVP 固定 platform_admin
		Username:     AdminUsername,
		PasswordHash: string(hash),
		DisplayName:  "系统管理员",
		Status:       models.UserStatusActive,
	}
	if err := db.Create(user).Error; err != nil {
		return fmt.Errorf("create admin user: %w", err)
	}
	return nil
}
