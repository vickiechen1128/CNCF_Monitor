package handler

import (
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

func newUserTestRouter(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m06_user.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	hash, err := bcrypt.GenerateFromPassword([]byte("secret123"), bcrypt.DefaultCost)
	require.NoError(t, err)
	for _, seed := range []models.User{
		{ID: "admin-1", TenantID: models.PlatformAdminTenantID, Username: "admin", DisplayName: "管理员一",
			PasswordHash: string(hash), Role: models.UserRoleAdmin, Status: models.UserStatusActive},
		{ID: "admin-2", TenantID: models.PlatformAdminTenantID, Username: "admin2", DisplayName: "管理员二",
			PasswordHash: string(hash), Role: models.UserRoleAdmin, Status: models.UserStatusActive},
		{ID: "user-1", TenantID: models.PlatformAdminTenantID, Username: "viewer", DisplayName: "只读用户",
			PasswordHash: string(hash), Role: models.UserRoleUser, Status: models.UserStatusActive},
		{ID: "user-2", TenantID: models.PlatformAdminTenantID, Username: "disabled", DisplayName: "停用用户",
			PasswordHash: string(hash), Role: models.UserRoleUser, Status: models.UserStatusDisabled},
	} {
		seed := seed
		require.NoError(t, gormDB.Create(&seed).Error)
	}
	for _, seed := range []models.Session{
		{ID: "sess-viewer", Token: "tok-viewer", UserID: "user-1", ExpiresAt: time.Now().Add(time.Hour)},
		{ID: "sess-admin-1", Token: "tok-admin-1", UserID: "admin-1", ExpiresAt: time.Now().Add(time.Hour)},
		{ID: "sess-admin-2", Token: "tok-admin-2", UserID: "admin-2", ExpiresAt: time.Now().Add(time.Hour)},
	} {
		seed := seed
		require.NoError(t, gormDB.Create(&seed).Error)
	}

	base := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	for _, seed := range []models.LoginLog{
		{ID: "log-1", Username: "admin", Success: true, IP: "10.0.0.1", Message: "ok", CreatedAt: base},
		{ID: "log-2", Username: "viewer", Success: false, IP: "10.0.0.2", Message: "bad password", CreatedAt: base.Add(time.Minute)},
		{ID: "log-3", Username: "viewer", Success: true, IP: "10.0.0.2", Message: "ok", CreatedAt: base.Add(2 * time.Minute)},
	} {
		seed := seed
		require.NoError(t, gormDB.Create(&seed).Error)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	userSvc := service.NewUserService(repository.NewGORMUserRepository(gormDB))
	loginLogSvc := service.NewLoginLogService(repository.NewGORMLoginLogRepository(gormDB))
	RegisterRoutes(router.Group("/api/v3/platform"), Handlers{
		Users:     NewUserHandler(userSvc),
		LoginLogs: NewLoginLogHandler(loginLogSvc),
	})
	return router, gormDB
}

func countSessions(t *testing.T, db *gorm.DB, userID string) int64 {
	t.Helper()
	var count int64
	require.NoError(t, db.Model(&models.Session{}).Where("user_id = ?", userID).Count(&count).Error)
	return count
}

func TestUserCreateListGet(t *testing.T) {
	router, gormDB := newUserTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/users",
		`{"username":"  ops01  ","display_name":"运维一号","password":"secret123"}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	id := data["id"].(string)
	assert.Regexp(t, regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`), id)
	assert.Equal(t, "ops01", data["username"])
	assert.Equal(t, "运维一号", data["display_name"])
	assert.Equal(t, models.UserRoleUser, data["role"])
	assert.Equal(t, models.PlatformAdminTenantID, data["tenant_id"])
	assert.Equal(t, "active", data["status"])
	assert.NotContains(t, data, "password_hash")
	assert.NotContains(t, data, "password")

	var persisted models.User
	require.NoError(t, gormDB.Where("id = ?", id).First(&persisted).Error)
	assert.NotEqual(t, "secret123", persisted.PasswordHash)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(persisted.PasswordHash), []byte("secret123")))

	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/users",
		`{"username":"ops01","display_name":"重复","password":"secret123"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/users",
		`{"username":"ops02","display_name":"管理员三","password":"secret123","role":"admin"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, models.UserRoleAdmin, out["data"].(map[string]any)["role"])

	longPassword := strings.Repeat("x", 73)
	invalidBodies := []string{
		`{"username":"","display_name":"x","password":"secret123"}`,
		`{"username":"x","display_name":"","password":"secret123"}`,
		`{"username":"x","display_name":"x","password":"short"}`,
		`{"username":"x","display_name":"x","password":"` + longPassword + `"}`,
		`{"username":"x","display_name":"x","password":"secret123","role":"owner"}`,
		`{"username":"x","display_name":"x","password":"secret123","tenant_id":"tenant-a"}`,
		`{"username":"x","display_name":"x","password":"secret123","status":"disabled"}`,
	}
	for _, body := range invalidBodies {
		code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/users", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/users?role=admin&page=1&page_size=1", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 3, listData["total"])
	assert.EqualValues(t, 1, listData["page"])
	assert.EqualValues(t, 1, listData["page_size"])
	require.Len(t, listData["list"], 1)

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/users?keyword=运维", "")
	require.Equal(t, http.StatusOK, code, out)
	listData = out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])
	assert.Equal(t, "ops01", listData["list"].([]any)[0].(map[string]any)["username"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/users?status=bogus", "")
	assert.Equal(t, http.StatusBadRequest, code)

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/users?role=bogus", "")
	assert.Equal(t, http.StatusBadRequest, code)
}

func TestUserUpdateAndRoleGuards(t *testing.T) {
	router, gormDB := newUserTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPut, "/api/v3/platform/users/user-1",
		`{"display_name":"  新展示名  ","role":"admin"}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "新展示名", data["display_name"])
	assert.Equal(t, models.UserRoleAdmin, data["role"])

	for _, body := range []string{
		`{}`,
		`{"username":"renamed"}`,
		`{"tenant_id":"tenant-a"}`,
		`{"status":"disabled"}`,
		`{"display_name":"  "}`,
		`{"role":"owner"}`,
	} {
		code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/users/user-1", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/users/missing", `{"display_name":"x"}`)
	assert.Equal(t, http.StatusNotFound, code)

	// Return the promoted user to the normal role before testing the guard.
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/users/user-1", `{"role":"user"}`)
	require.Equal(t, http.StatusOK, code, out)

	// Disable the second admin, then demoting admin-1 would leave no admin.
	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/admin-2/status",
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/users/admin-1", `{"role":"user"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	var admin models.User
	require.NoError(t, gormDB.Where("id = ?", "admin-1").First(&admin).Error)
	assert.Equal(t, models.UserRoleAdmin, admin.Role)
}

func TestUserStatusAndLastAdminGuard(t *testing.T) {
	router, gormDB := newUserTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/admin-2/status",
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "disabled", out["data"].(map[string]any)["status"])
	assert.Zero(t, countSessions(t, gormDB, "admin-2"), "disabling must revoke sessions")

	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/admin-1/status",
		`{"status":"disabled"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])
	assert.NotZero(t, countSessions(t, gormDB, "admin-1"))

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/users/admin-1", "")
	assert.Equal(t, http.StatusConflict, code, "deleting the last active admin must be a conflict")
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/user-1/status",
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Zero(t, countSessions(t, gormDB, "user-1"))

	// Idempotent disable and re-enable.
	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/user-1/status",
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/user-1/status",
		`{"status":"active"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "active", out["data"].(map[string]any)["status"])

	for _, body := range []string{`{}`, `{"status":""}`, `{"status":"locked"}`, `{"other":"active"}`} {
		code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/user-1/status", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/users/missing/status",
		`{"status":"disabled"}`)
	assert.Equal(t, http.StatusNotFound, code)
}

func TestUserResetPasswordAndDelete(t *testing.T) {
	router, gormDB := newUserTestRouter(t, adminUser())

	var before models.User
	require.NoError(t, gormDB.Where("id = ?", "user-1").First(&before).Error)

	code, out := doRequest(t, router, http.MethodPut, "/api/v3/platform/users/user-1/password",
		`{"new_password":"newsecret123"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, true, out["data"].(map[string]any)["password_reset"])
	assert.Zero(t, countSessions(t, gormDB, "user-1"))

	var after models.User
	require.NoError(t, gormDB.Where("id = ?", "user-1").First(&after).Error)
	assert.NotEqual(t, before.PasswordHash, after.PasswordHash)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(after.PasswordHash), []byte("newsecret123")))

	for _, body := range []string{`{}`, `{"new_password":"short"}`, `{"password":"newsecret123"}`} {
		code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/users/user-1/password", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}
	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/users/missing/password",
		`{"new_password":"newsecret123"}`)
	assert.Equal(t, http.StatusNotFound, code)

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/users/admin-1", "")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/users/user-1", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, true, out["data"].(map[string]any)["deleted"])
	assert.Zero(t, countSessions(t, gormDB, "user-1"))

	var deleted models.User
	require.NoError(t, gormDB.Where("id = ?", "user-1").First(&deleted).Error)
	require.NotNil(t, deleted.DeletedAt, "ordinary users are soft-deleted")

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/users/user-1", "")
	assert.Equal(t, http.StatusNotFound, code)
}

func TestLoginLogsFiltersAndShape(t *testing.T) {
	router, _ := newUserTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/login-logs", "")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 3, data["total"])
	list := data["list"].([]any)
	require.Len(t, list, 3)
	assert.Equal(t, "log-3", list[0].(map[string]any)["id"], "created_at desc")
	assert.NotContains(t, list[0].(map[string]any), "message")

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/login-logs?username=viewer&success=true", "")
	require.Equal(t, http.StatusOK, code, out)
	data = out["data"].(map[string]any)
	assert.EqualValues(t, 1, data["total"])
	assert.Equal(t, "log-3", data["list"].([]any)[0].(map[string]any)["id"])

	code, out = doRequest(t, router, http.MethodGet,
		"/api/v3/platform/login-logs?start_time=2026-11-11T10:00:30Z&end_time=2026-11-11T10:02:30Z", "")
	require.Equal(t, http.StatusOK, code, out)
	data = out["data"].(map[string]any)
	assert.EqualValues(t, 2, data["total"])

	for _, query := range []string{
		"success=maybe",
		"start_time=2026-11-11",
		"end_time=not-a-time",
		"start_time=2026-11-11T11:00:00Z&end_time=2026-11-11T10:00:00Z",
	} {
		code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/login-logs?"+query, "")
		assert.Equal(t, http.StatusBadRequest, code, query)
		assert.Equal(t, "bad_request", out["errorType"], query)
	}
}

func TestUserAndLoginLogAdminGate(t *testing.T) {
	viewer := &models.User{Role: models.UserRoleUser, Status: models.UserStatusActive}
	router, _ := newUserTestRouter(t, viewer)

	for _, path := range []string{"/api/v3/platform/users", "/api/v3/platform/login-logs"} {
		code, out := doRequest(t, router, http.MethodGet, path, "")
		assert.Equal(t, http.StatusForbidden, code, path)
		assert.Equal(t, "forbidden", out["errorType"], path)
	}

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/users",
		`{"username":"x","display_name":"x","password":"secret123"}`)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])
}
