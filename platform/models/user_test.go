package models

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestUserTableNames(t *testing.T) {
	assert.Equal(t, "users", User{}.TableName())
	assert.Equal(t, "sessions", Session{}.TableName())
	assert.Equal(t, "login_logs", LoginLog{}.TableName())
}

func TestUserJSONDoesNotExposePasswordHash(t *testing.T) {
	u := User{
		ID:           "u-1",
		TenantID:     PlatformAdminTenantID,
		Username:     "admin",
		PasswordHash: "$2a$10$secret-hash",
		DisplayName:  "系统管理员",
		Status:       UserStatusActive,
	}

	raw, err := json.Marshal(u)
	assert.NoError(t, err)

	s := string(raw)
	assert.NotContains(t, s, "password_hash")
	assert.NotContains(t, s, "secret-hash")
	assert.Contains(t, s, `"username":"admin"`)
	assert.Contains(t, s, `"display_name":"系统管理员"`)
	assert.Contains(t, s, `"tenant_id":"platform_admin"`)
	assert.Contains(t, s, `"status":"active"`)
}

func TestUserStatusConstants(t *testing.T) {
	// PRD Module_06 §5.3: active / disabled
	assert.Equal(t, UserStatus("active"), UserStatusActive)
	assert.Equal(t, UserStatus("disabled"), UserStatusDisabled)
}

func TestSessionTTLSemantic(t *testing.T) {
	// PRD Module_03 §4.0: 服务端会话有效期 12 小时。
	assert.Equal(t, 12*time.Hour, SessionTTL)
}

func TestSessionJSONContract(t *testing.T) {
	expiresAt := time.Date(2026, 8, 28, 22, 0, 0, 0, time.UTC)
	sess := Session{
		ID:        "s-1",
		Token:     "opaque-token",
		UserID:    "u-1",
		ExpiresAt: expiresAt,
	}

	raw, err := json.Marshal(sess)
	assert.NoError(t, err)

	s := string(raw)
	assert.Contains(t, s, `"token":"opaque-token"`)
	assert.Contains(t, s, `"user_id":"u-1"`)
	assert.True(t, strings.Contains(s, `"expires_at"`))
}

func TestLoginLogJSONContract(t *testing.T) {
	log := LoginLog{
		ID:       "l-1",
		Username: "admin",
		Success:  false,
		IP:       "127.0.0.1",
		Message:  "密码错误",
	}

	raw, err := json.Marshal(log)
	assert.NoError(t, err)

	s := string(raw)
	assert.Contains(t, s, `"username":"admin"`)
	assert.Contains(t, s, `"success":false`)
	assert.Contains(t, s, `"ip":"127.0.0.1"`)
	assert.Contains(t, s, `"message":"密码错误"`)
}
