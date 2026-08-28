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
