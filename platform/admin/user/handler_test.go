package user

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

// memDBCounter produces a unique in-memory DB name per test so sequential and
// parallel tests in one package never share the same backing database.
var memDBCounter int64

// openTestDB opens a per-test in-memory SQLite database with exactly the tables
// the user package touches.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:adminuser_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.User{},
		&models.Session{},
		&models.LoginLog{},
	))
	return db
}

// newTestRouter builds a gin engine with the user admin routes mounted under
// /api/v2/platform, mirroring main.go wiring.
func newTestRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	RegisterRoutes(platform, db)
	return r
}

// perform executes a request against the given engine and returns the recorder.
func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
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

// decodeEnvelope parses the response body into the unified envelope.
func decodeEnvelope(t *testing.T, w *httptest.ResponseRecorder) envelope {
	t.Helper()
	var env envelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	return env
}

// seedSession inserts an active session row for the given user (fixture helper).
func seedSession(t *testing.T, db *gorm.DB, userID, token string) {
	t.Helper()
	s := &models.Session{
		ID:        "sess-" + token,
		Token:     token,
		UserID:    userID,
		ExpiresAt: time.Now().Add(models.SessionTTL),
	}
	require.NoError(t, db.Create(s).Error)
}

// countSessions returns the number of session rows owned by userID.
func countSessions(t *testing.T, db *gorm.DB, userID string) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.Session{}).Where("user_id = ?", userID).Count(&n).Error)
	return n
}

// createUserViaAPI is a shortcut that creates a user through the HTTP API and
// returns the decoded data payload.
func createUserViaAPI(t *testing.T, r *gin.Engine, username, displayName, password string) map[string]interface{} {
	t.Helper()
	body := fmt.Sprintf(`{"username":%q,"display_name":%q,"password":%q}`, username, displayName, password)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/users", body)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	require.Equal(t, "success", env.Status)
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	return data
}

func TestCreateUser_Success(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	data := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	assert.NotEmpty(t, data["id"])
	assert.Equal(t, "ops01", data["username"])
	assert.Equal(t, "运维一号", data["display_name"])
	assert.Equal(t, models.UserRoleUser, data["role"], "新建用户一律为普通用户（用户不可自提权为 admin）")
	assert.Equal(t, "active", data["status"])
	assert.NotEmpty(t, data["created_at"])

	// bcrypt 哈希落库且可校验，明文不落库；Role 固定 user。
	var stored models.User
	require.NoError(t, db.Where("username = ?", "ops01").First(&stored).Error)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("secret123")))
	assert.Equal(t, models.PlatformAdminTenantID, stored.TenantID)
	assert.Equal(t, models.UserRoleUser, stored.Role)
}

func TestCreateUser_ResponseNeverLeaksPasswordHash(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	for _, path := range []string{"/api/v2/platform/users"} {
		w := perform(t, r, http.MethodGet, path, "")
		require.Equal(t, http.StatusOK, w.Code)
		assert.NotContains(t, w.Body.String(), "password_hash")
		assert.NotContains(t, w.Body.String(), "$2a$")
	}
}

func TestCreateUser_DuplicateUsername(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	w := perform(t, r, http.MethodPost, "/api/v2/platform/users",
		`{"username":"ops01","display_name":"重名","password":"secret456"}`)
	require.Equal(t, http.StatusConflict, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "error", env.Status)
	assert.Equal(t, "conflict", env.ErrorType)
}

func TestCreateUser_Validation(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"missing username", `{"display_name":"运维一号","password":"secret123"}`},
		{"blank username", `{"username":"  ","display_name":"运维一号","password":"secret123"}`},
		{"missing display_name", `{"username":"ops01","password":"secret123"}`},
		{"missing password", `{"username":"ops01","display_name":"运维一号"}`},
		{"short password", `{"username":"ops01","display_name":"运维一号","password":"abc"}`},
		{"malformed json", `{"username":`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := openTestDB(t)
			r := newTestRouter(db)
			w := perform(t, r, http.MethodPost, "/api/v2/platform/users", tt.body)
			require.Equal(t, http.StatusBadRequest, w.Code, "body: %s", w.Body.String())
			env := decodeEnvelope(t, w)
			assert.Equal(t, "bad_request", env.ErrorType)
		})
	}
}

func TestDeleteUser_RemoveOrdinaryUser(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	data := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := data["id"].(string)
	seedSession(t, db, id, "tok-ops01")

	w := perform(t, r, http.MethodDelete, "/api/v2/platform/users/"+id, "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	assert.Equal(t, "success", decodeEnvelope(t, w).Status)

	// 会话已清理；软删后正常查询（deleted_at IS NULL）不再命中
	assert.Zero(t, countSessions(t, db, id))
	var n int64
	require.NoError(t, db.Model(&models.User{}).
		Where("id = ? AND deleted_at IS NULL", id).Count(&n).Error)
	assert.Zero(t, n)
}

func TestDeleteUser_AdminForbidden(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	hash, err := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.DefaultCost)
	require.NoError(t, err)
	admin := &models.User{
		ID: "admin1", TenantID: models.PlatformAdminTenantID, Username: "root",
		DisplayName: "管理员", PasswordHash: string(hash),
		Role: models.UserRoleAdmin, Status: models.UserStatusActive,
	}
	require.NoError(t, db.Create(admin).Error)

	w := perform(t, r, http.MethodDelete, "/api/v2/platform/users/admin1", "")
	require.Equal(t, http.StatusBadRequest, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "bad_request", env.ErrorType)

	var n int64
	require.NoError(t, db.Model(&models.User{}).Where("id = ? AND deleted_at IS NULL", admin.ID).Count(&n).Error)
	assert.Equal(t, int64(1), n)
}

func TestDeleteUser_NotFound(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	w := perform(t, r, http.MethodDelete, "/api/v2/platform/users/no-such", "")
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", decodeEnvelope(t, w).ErrorType)
}

func TestListUsers_PaginationAndFields(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	createUserViaAPI(t, r, "ops02", "运维二号", "secret123")

	w := perform(t, r, http.MethodGet, "/api/v2/platform/users", "")
	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	var data struct {
		Items []map[string]interface{} `json:"items"`
		Total int64                    `json:"total"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(2), data.Total)
	require.Len(t, data.Items, 2)
	for _, item := range data.Items {
		assert.Contains(t, item, "id")
		assert.Contains(t, item, "username")
		assert.Contains(t, item, "display_name")
		assert.Contains(t, item, "status")
		assert.Contains(t, item, "created_at")
	}

	// 分页：page_size=1 时每页 1 条，total 仍为全量。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/users?page=2&page_size=1", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(2), data.Total)
	require.Len(t, data.Items, 1)
}

func TestUpdateUser_DisplayName(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	created := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := created["id"].(string)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/users/"+id, `{"display_name":"运维一号改"}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, "运维一号改", data["display_name"])
	assert.Equal(t, "ops01", data["username"])

	var stored models.User
	require.NoError(t, db.First(&stored, "id = ?", id).Error)
	assert.Equal(t, "运维一号改", stored.DisplayName)
}

func TestUpdateUser_UsernameImmutable(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	created := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := created["id"].(string)

	// 请求含 username 字段即拒绝（契约快照 §2：视为 400），即使值未变化。
	for _, body := range []string{
		`{"username":"ops02","display_name":"x"}`,
		`{"username":"ops01"}`,
	} {
		w := perform(t, r, http.MethodPut, "/api/v2/platform/users/"+id, body)
		require.Equal(t, http.StatusBadRequest, w.Code, "body=%s resp=%s", body, w.Body.String())
		env := decodeEnvelope(t, w)
		assert.Equal(t, "bad_request", env.ErrorType)
	}

	var stored models.User
	require.NoError(t, db.First(&stored, "id = ?", id).Error)
	assert.Equal(t, "ops01", stored.Username)
}

func TestUpdateUser_NotFound(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/users/no-such-id", `{"display_name":"x"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "not_found", env.ErrorType)
}

func TestUpdateUserStatus_DisableInvalidatesSessions(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	created := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := created["id"].(string)
	seedSession(t, db, id, "tok-1")
	seedSession(t, db, id, "tok-2")
	require.Equal(t, int64(2), countSessions(t, db, id))

	w := perform(t, r, http.MethodPatch, "/api/v2/platform/users/"+id+"/status", `{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data map[string]interface{}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, "disabled", data["status"])

	// 禁用后已有会话立即失效（sessions 行被删除）。
	assert.Equal(t, int64(0), countSessions(t, db, id))

	// 恢复启用不报错，状态翻转回 active。
	w = perform(t, r, http.MethodPatch, "/api/v2/platform/users/"+id+"/status", `{"status":"active"}`)
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, "active", data["status"])
}

func TestUpdateUserStatus_InvalidValue(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	created := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := created["id"].(string)

	for _, body := range []string{`{"status":"locked"}`, `{"status":""}`, `{}`} {
		w := perform(t, r, http.MethodPatch, "/api/v2/platform/users/"+id+"/status", body)
		require.Equal(t, http.StatusBadRequest, w.Code, "body=%s resp=%s", body, w.Body.String())
		env := decodeEnvelope(t, w)
		assert.Equal(t, "bad_request", env.ErrorType)
	}
}

func TestUpdateUserStatus_NotFound(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	w := perform(t, r, http.MethodPatch, "/api/v2/platform/users/no-such-id/status", `{"status":"disabled"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", decodeEnvelope(t, w).ErrorType)
}

func TestResetPassword_UpdatesHashAndInvalidatesSessions(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	created := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := created["id"].(string)
	seedSession(t, db, id, "tok-1")

	w := perform(t, r, http.MethodPut, "/api/v2/platform/users/"+id+"/password", `{"new_password":"newpass456"}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())

	var stored models.User
	require.NoError(t, db.First(&stored, "id = ?", id).Error)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("newpass456")))
	assert.Error(t, bcrypt.CompareHashAndPassword([]byte(stored.PasswordHash), []byte("secret123")))

	// 重置密码后旧会话失效。
	assert.Equal(t, int64(0), countSessions(t, db, id))
}

func TestResetPassword_ValidationAndNotFound(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)
	created := createUserViaAPI(t, r, "ops01", "运维一号", "secret123")
	id := created["id"].(string)

	// 新密码过短 → 400。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/users/"+id+"/password", `{"new_password":"abc"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", decodeEnvelope(t, w).ErrorType)

	// 缺 new_password → 400。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/users/"+id+"/password", `{}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 用户不存在 → 404。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/users/no-such-id/password", `{"new_password":"newpass456"}`)
	require.Equal(t, http.StatusNotFound, w.Code)
	assert.Equal(t, "not_found", decodeEnvelope(t, w).ErrorType)
}

func TestListLoginLogs_FilterOrderPagination(t *testing.T) {
	db := openTestDB(t)
	r := newTestRouter(db)

	base := time.Date(2026, 8, 28, 10, 0, 0, 0, time.UTC)
	logs := []models.LoginLog{
		{ID: "l1", Username: "admin", Success: true, IP: "10.0.0.1", CreatedAt: base},
		{ID: "l2", Username: "ops01", Success: false, IP: "10.0.0.2", Message: "密码错误", CreatedAt: base.Add(time.Minute)},
		{ID: "l3", Username: "ops01", Success: true, IP: "10.0.0.3", CreatedAt: base.Add(2 * time.Minute)},
	}
	for i := range logs {
		require.NoError(t, db.Create(&logs[i]).Error)
	}

	// 无筛选：按时间倒序返回全部。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/login-logs", "")
	require.Equal(t, http.StatusOK, w.Code)
	env := decodeEnvelope(t, w)
	var data struct {
		Items []map[string]interface{} `json:"items"`
		Total int64                    `json:"total"`
	}
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(3), data.Total)
	require.Len(t, data.Items, 3)
	assert.Equal(t, "l3", data.Items[0]["id"])
	assert.Equal(t, "l2", data.Items[1]["id"])
	assert.Equal(t, "l1", data.Items[2]["id"])
	assert.Contains(t, data.Items[0], "username")
	assert.Contains(t, data.Items[0], "success")
	assert.Contains(t, data.Items[0], "ip")
	assert.Contains(t, data.Items[0], "created_at")

	// 按 username 精确筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/login-logs?username=ops01", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(2), data.Total)

	// 按 success 筛选。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/login-logs?success=false", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(1), data.Total)
	assert.Equal(t, "l2", data.Items[0]["id"])

	// success 非法值 → 400。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/login-logs?success=maybe", "")
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Equal(t, "bad_request", decodeEnvelope(t, w).ErrorType)

	// 分页：page_size=2 时第二页剩 1 条，total 为全量。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/login-logs?page=2&page_size=2", "")
	require.Equal(t, http.StatusOK, w.Code)
	env = decodeEnvelope(t, w)
	require.NoError(t, json.Unmarshal(env.Data, &data))
	assert.Equal(t, int64(3), data.Total)
	require.Len(t, data.Items, 1)
}
