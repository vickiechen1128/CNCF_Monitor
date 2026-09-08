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
	// AppEnvEnv 声明当前运行环境的环境变量名（METRIC_CENTER_ENV）。
	// Seed 据此在 production 模式下强制要求显式配置初始管理员密码，从而拒绝
	// 生产环境使用内置默认密码 admin123（H-1）。非生产环境仍回退默认密码。
	AppEnvEnv = "METRIC_CENTER_ENV"
	// EnvProduction 是 AppEnvEnv 的取值之一，表示生产运行模式。
	EnvProduction = "production"
	// DefaultAdminPassword is the initial admin password used when
	// AdminPasswordEnv is not configured. 首次登录后应引导改密。
	// 注意：仅在非生产模式（METRIC_CENTER_ENV != production）下作为回退。
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
	// 生产模式（H-1）：必须显式配置初始管理员密码，拒绝使用内置默认密码 admin123，
	// 使生产启动在 db.Init -> seed.Run 处失败（经 main.Fatalf 终止），从而避免
	// 生产环境携带弱默认凭据被入侵。非生产模式仍安全回退到 DefaultAdminPassword。
	if password == "" && os.Getenv(AppEnvEnv) == EnvProduction {
		return errors.New("METRIC_CENTER_ADMIN_PASSWORD must be configured in production mode; refusing insecure default")
	}
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
		Role:         models.UserRoleAdmin, // H-2：初始管理员角色必须是 admin
		Status:       models.UserStatusActive,
	}
	if err := db.Create(user).Error; err != nil {
		return fmt.Errorf("create admin user: %w", err)
	}
	return nil
}
