package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// TestRunSeedsAdminUser verifies the initial admin account is seeded with the
// default password (bcrypt-hashed), bound to the platform_admin tenant, and
// active (Module_06 §5.3 / §9.2).
func TestRunSeedsAdminUser(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))

	var u models.User
	require.NoError(t, db.Where("username = ?", "admin").First(&u).Error)
	assert.Equal(t, models.PlatformAdminTenantID, u.TenantID)
	assert.Equal(t, models.UserStatusActive, u.Status)
	assert.NotEmpty(t, u.ID)
	assert.NotEmpty(t, u.DisplayName)
	// 密码必须 bcrypt 哈希存储，且绝不落明文。
	assert.NotEqual(t, DefaultAdminPassword, u.PasswordHash)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(DefaultAdminPassword)))
}

// TestRunAdminIsIdempotent verifies repeated seeding never duplicates the
// admin row (upsert 语义：存在即跳过).
func TestRunAdminIsIdempotent(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))
	require.NoError(t, Run(db))

	var n int64
	countRows(t, db, &models.User{}, &n)
	assert.Equal(t, int64(1), n, "admin user is unique after repeated seeding")
}

// TestRunAdminKeepsModifiedPassword verifies seeding never resets a password
// that was changed after the first boot (upsert 语义：存在即跳过).
func TestRunAdminKeepsModifiedPassword(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))

	// 模拟用户改密：覆盖 password_hash。
	newHash, err := bcrypt.GenerateFromPassword([]byte("changed-password"), bcrypt.DefaultCost)
	require.NoError(t, err)
	require.NoError(t, db.Model(&models.User{}).Where("username = ?", "admin").
		Update("password_hash", string(newHash)).Error)

	require.NoError(t, Run(db))

	var u models.User
	require.NoError(t, db.Where("username = ?", "admin").First(&u).Error)
	assert.Equal(t, string(newHash), u.PasswordHash, "modified password must not be reset by re-seeding")
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("changed-password")))
}

// TestRunAdminPasswordFromEnv verifies the initial password comes from the
// deployment configuration (environment variable), falling back to the
// default only when unset.
func TestRunAdminPasswordFromEnv(t *testing.T) {
	db := newTestDB(t)
	t.Setenv(AdminPasswordEnv, "s3cret-deploy")

	require.NoError(t, Run(db))

	var u models.User
	require.NoError(t, db.Where("username = ?", "admin").First(&u).Error)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("s3cret-deploy")))
	assert.Error(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(DefaultAdminPassword)))
}

// TestAdminUser_ProductionRequiresEnvPassword verifies H-1: in production mode
// (METRIC_CENTER_ENV=production) the initial admin password must be explicitly
// configured via METRIC_CENTER_ADMIN_PASSWORD; seeding must fail and no admin
// row may be created when it is absent. Non-production keeps the default fallback.
func TestAdminUser_ProductionRequiresEnvPassword(t *testing.T) {
	db := newTestDB(t)
	// 显式置空密码并声明 production 环境。
	t.Setenv(AdminPasswordEnv, "")
	t.Setenv(AppEnvEnv, EnvProduction)

	err := Run(db)
	require.Error(t, err, "生产模式未配置密码必须报错并拒绝启动")
	assert.Contains(t, err.Error(), AdminPasswordEnv)

	// 失败时不得创建 admin 用户。
	var n int64
	countRows(t, db, &models.User{}, &n)
	assert.Equal(t, int64(0), n, "生产模式未配置密码时不得创建 admin")

	// 配置密码后再次 seed 应成功，且初始管理员 Role 为 admin（H-2）。
	t.Setenv(AdminPasswordEnv, "prod-secret-4711")
	require.NoError(t, Run(db))
	var u models.User
	require.NoError(t, db.Where("username = ?", "admin").First(&u).Error)
	assert.Equal(t, models.UserRoleAdmin, u.Role, "初始管理员角色必须是 admin")
}
