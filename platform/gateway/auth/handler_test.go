package auth

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// memDBSeq produces a unique in-memory DB name per test so sequential/parallel
// tests in one package never share the same backing database.
var memDBSeq int64

// openTestDB opens a per-test in-memory SQLite DB with exactly the tables the
// auth package touches.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBSeq, 1)
	dsn := fmt.Sprintf("file:auth_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.User{},
		&models.Session{},
		&models.LoginLog{},
	))
	return db
}

// newTestRouter builds a gin engine with the auth routes under /api/v2/platform.
func newTestRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	RegisterRoutes(platform, db)
	return r
}

// login performs a password-keyed request (with optional Bearer header) and
// returns the recorder.
func perform(t *testing.T, r *gin.Engine, method, path, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// envelope is the decoded unified response envelope.
type envelope struct {
	Status    string          `json:"status"`
	Data      json.RawMessage `json:"data"`
	ErrorType string          `json:"errorType"`
	Error     string          `json:"error"`
}

func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	return env
}

// seedUser inserts an active user with a bcrypt hash of password（fixture 助手）。
func seedUser(t *testing.T, db *gorm.DB, id, username, displayName, password string) *models.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	require.NoError(t, err)
	u := &models.User{
		ID:           id,
		TenantID:     models.PlatformAdminTenantID,
		Username:     username,
		PasswordHash: string(hash),
		DisplayName:  displayName,
		Status:       models.UserStatusActive,
	}
	require.NoError(t, db.Create(u).Error)
	return u
}

// loginAndToken logs in via the API and returns the raw token string.
func loginAndToken(t *testing.T, r *gin.Engine, username, password string) string {
	t.Helper()
	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login",
		fmt.Sprintf(`{"username":%q,"password":%q}`, username, password), "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	require.NotEmpty(t, data.Token)
	return data.Token
}

func countSessions(t *testing.T, db *gorm.DB, userID string) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.Session{}).Where("user_id = ?", userID).Count(&n).Error)
	return n
}

func countLoginLogs(t *testing.T, db *gorm.DB, username string) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.LoginLog{}).Where("username = ?", username).Count(&n).Error)
	return n
}

func TestLogin_Success(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")

	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", `{"username":"admin","password":"admin123"}`, "")
	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "success", env.Status)
	var data struct {
		Token     string `json:"token"`
		ExpiresAt string `json:"expires_at"`
		User      struct {
			ID          string `json:"id"`
			Username    string `json:"username"`
			DisplayName string `json:"display_name"`
			TenantID    string `json:"tenant_id"`
		} `json:"user"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.NotEmpty(t, data.Token)
	assert.Contains(t, data.ExpiresAt, "T") // RFC3339
	assert.Equal(t, "admin", data.User.Username)
	assert.Equal(t, "系统管理员", data.User.DisplayName)
	assert.Equal(t, models.PlatformAdminTenantID, data.User.TenantID)
	// login user 对象不含 last_login_at / password_hash。
	assert.NotContains(t, w.Body.String(), "password_hash")
	assert.NotContains(t, w.Body.String(), "last_login_at")

	// 会话已落库，token 与 user 关联，过期时间为 12h 之后。
	var sess models.Session
	require.NoError(t, db.First(&sess, "token = ?", data.Token).Error)
	assert.Equal(t, "u1", sess.UserID)
	assert.True(t, time.Until(sess.ExpiresAt) > 11*time.Hour)

	// 成功写 LoginLog。
	assert.Equal(t, int64(1), countLoginLogs(t, db, "admin"))

	// last_login_at 已盖章。
	var stored models.User
	require.NoError(t, db.First(&stored, "id = ?", "u1").Error)
	require.NotNil(t, stored.LastLoginAt)
}

func TestLogin_Failure_UnifiedAndLogged(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")

	// 错误密码 vs 不存在账号：响应必须完全一致以防账号枚举。
	wrongPW := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", `{"username":"admin","password":"wrongpass"}`, "")
	noSuch := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", `{"username":"ghost","password":"whatever1"}`, "")
	for _, tt := range []*httptest.ResponseRecorder{wrongPW, noSuch} {
		require.Equal(t, http.StatusUnauthorized, tt.Code)
		env := decodeEnvelope(t, tt)
		assert.Equal(t, "error", env.Status)
		assert.Equal(t, "unauthorized", env.ErrorType)
		assert.Equal(t, "用户名或密码错误", env.Error)
		assert.Empty(t, env.Data)
	}
	assert.Equal(t, wrongPW.Body.String(), noSuch.Body.String(), "failure must not distinguish reason")

	// 失败均写 LoginLog。
	assert.Equal(t, int64(1), countLoginLogs(t, db, "admin"))
	assert.Equal(t, int64(1), countLoginLogs(t, db, "ghost"))

	// 登录日志的 message 不含明文密码或哈希。
	var logged models.LoginLog
	require.NoError(t, db.Where("username = ?", "admin").First(&logged).Error)
	assert.False(t, logged.Success)
	assert.NotContains(t, logged.Message, "wrongpass")
	assert.NotContains(t, logged.Message, "$2a$")
}

func TestLogin_DisabledUser(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	u := seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	u.Status = models.UserStatusDisabled
	require.NoError(t, db.Save(u).Error)

	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", `{"username":"admin","password":"admin123"}`, "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
	assert.Equal(t, "用户名或密码错误", decodeEnvelope(t, w).Error)
	// 禁用账号登录失败也写 LoginLog。
	require.NoError(t, db.Where("username = ? AND success = ?", "admin", false).First(&models.LoginLog{}).Error)
}

func TestLogin_ResponseNeverLeaksPasswordHash(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")

	for _, body := range []string{
		`{"username":"admin","password":"badpass1"}`, // 失败
		`{"username":"admin","password":"admin123"}`, // 成功
	} {
		w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", body, "")
		require.True(t, w.Code == http.StatusOK || w.Code == http.StatusUnauthorized)
		// 任何登录响应都不泄露 password_hash 或 bcrypt 前缀 `$2a$`。
		assert.NotContains(t, w.Body.String(), "password_hash")
		assert.NotContains(t, w.Body.String(), "$2a$")
		// 明文密码不回显。
		assert.NotContains(t, w.Body.String(), body)
	}
}

func TestLogin_MalformedJSON(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", `{"username":`, "")
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", decodeEnvelope(t, w).ErrorType)
}

func TestLogout_Idempotent(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")

	token := loginAndToken(t, r, "admin", "admin123")
	require.Equal(t, int64(1), countSessions(t, db, "u1"))

	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/logout", "", token)
	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "success", env.Status)
	assert.Empty(t, env.Data) // data=null
	assert.Equal(t, int64(0), countSessions(t, db, "u1"))

	// 幂等：再次登出同一 token 仍返回 200。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/auth/logout", "", token)
	require.Equal(t, http.StatusOK, w.Code)
}

func TestLogout_MissingToken(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/logout", "", "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
}

func TestMe_ValidToken(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")

	w := perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", token)
	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	var data meDTO
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, "u1", data.ID)
	assert.Equal(t, "admin", data.Username)
	assert.Equal(t, "系统管理员", data.DisplayName)
	assert.Equal(t, models.PlatformAdminTenantID, data.TenantID)
	require.NotNil(t, data.LastLoginAt)
	// me 不含 password_hash。
	assert.NotContains(t, w.Body.String(), "password_hash")
}

func TestMe_InvalidOrMissingToken(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")

	// 无 token。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	// 无效 token。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", "garbage-token")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	// 登出后的 token 失效。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/auth/logout", "", token)
	require.Equal(t, http.StatusOK, w.Code)
	w = perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", token)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
}

func TestMe_ExpiredSession(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")

	// 人为把会话过期时间改成过去，使校验路径命中过期分支。
	require.NoError(t, db.Model(&models.Session{}).
		Where("token = ?", token).Update("expires_at", time.Now().Add(-time.Minute)).Error)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", token)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
}

func TestMe_DisabledUserSessionInvalid(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")

	var u models.User
	require.NoError(t, db.First(&u, "id = ?", "u1").Error)
	u.Status = models.UserStatusDisabled
	require.NoError(t, db.Save(u).Error)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", token)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
}

func TestChangePassword_SuccessInvalidatesSessions(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")
	// 第二个会话一起失效。
	require.NoError(t, db.Create(&models.Session{
		ID: "sess2", Token: "tok-other", UserID: "u1", ExpiresAt: time.Now().Add(time.Hour),
	}).Error)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/auth/password",
		`{"old_password":"admin123","new_password":"newpass456"}`, token)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "success", env.Status)
	assert.Empty(t, env.Data)

	// 新哈希落库、旧密码不再可校验。
	var stored models.User
	require.NoError(t, db.First(&stored, "id = ?", "u1").Error)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("newpass456")))
	assert.Error(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("admin123")))

	// 改密后旧会话全部失效（含当前、含额外会话）。
	assert.Equal(t, int64(0), countSessions(t, db, "u1"))

	// 旧 token 不再可用，新密码可登录。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", token)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	newToken := loginAndToken(t, r, "admin", "newpass456")
	w = perform(t, r, http.MethodGet, "/api/v2/platform/auth/me", "", newToken)
	require.Equal(t, http.StatusOK, w.Code)
}

func TestChangePassword_WrongOldPassword(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")

	w := perform(t, r, http.MethodPut, "/api/v2/platform/auth/password",
		`{"old_password":"wrongold","new_password":"newpass456"}`, token)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "unauthorized", env.ErrorType)
	assert.Equal(t, "旧密码错误", env.Error)

	// 密码未变、会话未被清除。
	var stored models.User
	require.NoError(t, db.First(&stored, "id = ?", "u1").Error)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("admin123")))
	assert.Equal(t, int64(1), countSessions(t, db, "u1"))
}

func TestChangePassword_Validation(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginAndToken(t, r, "admin", "admin123")

	// 新密码过短 → 400 bad_request。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/auth/password",
		`{"old_password":"admin123","new_password":"abc"}`, token)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", decodeEnvelope(t, w).ErrorType)

	// 缺字段 → 400。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/auth/password", `{}`, token)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 未认证（无 token）→ 401，即便 body 非法也该先拦会话。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/auth/password",
		`{"old_password":"admin123","new_password":"newpass456"}`, "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthenticate_ReuseFixture(t *testing.T) {
	// au-02 复用层语义：Authenticate 提供中间件所需的会话校验。
	db := openTestDB(t)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	svc := NewService(NewRepository(db))

	token, err := generateToken()
	require.NoError(t, err)
	require.NoError(t, db.Create(&models.Session{
		ID: "sess", Token: token, UserID: "u1",
		ExpiresAt: time.Now().Add(models.SessionTTL),
	}).Error)

	u, err := svc.Authenticate(token)
	require.NoError(t, err)
	assert.Equal(t, "admin", u.Username)

	// 无效 token。
	_, err = svc.Authenticate("nope")
	assert.ErrorIs(t, err, ErrUnauthorized)
	// 空 token。
	_, err = svc.Authenticate("")
	assert.ErrorIs(t, err, ErrUnauthorized)
}

func TestGenerateToken_StrengthAndUniqueness(t *testing.T) {
	a, err := generateToken()
	require.NoError(t, err)
	b, err := generateToken()
	require.NoError(t, err)
	assert.Len(t, a, 64)
	assert.NotEqual(t, a, b)
	// hex 字符集。
	for _, r := range a {
		assert.True(t, strings.ContainsRune("0123456789abcdef", r))
	}
}