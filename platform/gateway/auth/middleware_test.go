package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// newMiddlewareRouter builds a gin engine that applies AuthMiddleware globally
// and exposes: a protected endpoint (echoes the resolved user from context),
// the anonymous health endpoints, and an auth/login stub, mirroring the
// setupRouter wiring of main.go.
func newMiddlewareRouter(db *gorm.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(AuthMiddleware(NewService(NewRepository(db))))

	api := r.Group("/api/v1")
	api.GET("/protected", func(c *gin.Context) {
		u := c.MustGet(ContextUserKey).(*models.User)
		response.OK(c, gin.H{"username": u.Username})
	})
	api.OPTIONS("/protected", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})
	api.GET("/health", func(c *gin.Context) { response.OK(c, gin.H{"status": "ok"}) })
	api.GET("/health/db", func(c *gin.Context) { response.OK(c, gin.H{"status": "ok"}) })
	api.GET("/status", func(c *gin.Context) { response.OK(c, gin.H{"status": "ok"}) })

	v2 := r.Group("/api/v2/platform/auth")
	v2.POST("/login", func(c *gin.Context) { response.OK(c, gin.H{"ok": true}) })
	return r
}

// loginToken obtains a valid session token through the service layer.
func loginToken(t *testing.T, db *gorm.DB, username, password string) string {
	t.Helper()
	svc := NewService(NewRepository(db))
	res, err := svc.Login(username, password, "127.0.0.1")
	require.NoError(t, err)
	return res.Token
}

// unmarshalData decodes an envelope's raw data into v.
func unmarshalData(t *testing.T, raw json.RawMessage, v interface{}) {
	t.Helper()
	require.NoError(t, json.Unmarshal(raw, v))
}

func TestMiddleware_AnonymousProtectedRejected(t *testing.T) {
	db := openTestDB(t)
	r := newMiddlewareRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")

	// 无 token → 401。
	w := perform(t, r, http.MethodGet, "/api/v1/protected", "", "")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "error", env.Status)
	assert.Equal(t, "unauthorized", env.ErrorType)

	// 畸形 Authorization（非 Bearer）→ 401。
	req := httptest.NewRequest(http.MethodGet, "/api/v1/protected", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, rec).ErrorType)
}

func TestMiddleware_LoginAndHealthBypass(t *testing.T) {
	db := openTestDB(t)
	r := newMiddlewareRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")

	// 匿名可访问健康检查与状态（无需 token）。
	for _, path := range []string{"/api/v1/health", "/api/v1/health/db", "/api/v1/status"} {
		w := perform(t, r, http.MethodGet, path, "", "")
		require.Equal(t, http.StatusOK, w.Code, "path %s 应放行: %s", path, w.Body.String())
		assert.Equal(t, "success", decodeEnvelope(t, w).Status)
	}

	// 匿名 POST login 放行并真正签发 token。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/auth/login", `{"username":"admin","password":"admin123"}`, "")
	require.Equal(t, http.StatusOK, w.Code, "login 应放行: %s", w.Body.String())
	assert.Equal(t, "success", decodeEnvelope(t, w).Status)
}

func TestMiddleware_ValidTokenPasses(t *testing.T) {
	db := openTestDB(t)
	r := newMiddlewareRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	token := loginToken(t, db, "admin", "admin123")

	w := perform(t, r, http.MethodGet, "/api/v1/protected", "", token)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	var data struct {
		Username string `json:"username"`
	}
	unmarshalData(t, env.Data, &data)
	assert.Equal(t, "admin", data.Username, "中间件应将认证用户写入 context")
}

func TestMiddleware_ExpiredLogoutDisabledRejected(t *testing.T) {
	db := openTestDB(t)
	r := newMiddlewareRouter(db)
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	svc := NewService(NewRepository(db))

	// 登出后 token 失效。
	token := loginToken(t, db, "admin", "admin123")
	require.NoError(t, svc.Logout(token))
	w := perform(t, r, http.MethodGet, "/api/v1/protected", "", token)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)

	// 过期会话。
	token2 := loginToken(t, db, "admin", "admin123")
	require.NoError(t, db.Model(&models.Session{}).
		Where("token = ?", token2).Update("expires_at", time.Now().Add(-time.Minute)).Error)
	w = perform(t, r, http.MethodGet, "/api/v1/protected", "", token2)
	require.Equal(t, http.StatusUnauthorized, w.Code)

	// 用户被禁用。
	token3 := loginToken(t, db, "admin", "admin123")
	var u models.User
	require.NoError(t, db.First(&u, "id = ?", "u1").Error)
	u.Status = models.UserStatusDisabled
	require.NoError(t, db.Save(u).Error)
	w = perform(t, r, http.MethodGet, "/api/v1/protected", "", token3)
	require.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Equal(t, "unauthorized", decodeEnvelope(t, w).ErrorType)
}

func TestMiddleware_OptionsPreflightPasses(t *testing.T) {
	db := openTestDB(t)
	r := newMiddlewareRouter(db)

	// OPTIONS 预检不要求认证。
	w := perform(t, r, http.MethodOptions, "/api/v1/protected", "", "")
	require.Equal(t, http.StatusNoContent, w.Code)
}

func TestMiddleware_NoAuthorization(t *testing.T) {
	db := openTestDB(t)
	r := newMiddlewareRouter(db)
	// 不同用户（无任何角色字段）持有效 token 都可达受保护接口，且始终不会被
	// 403 拦截——中间件只做认证，不做任何角色/权限点校验。
	seedUser(t, db, "u1", "admin", "系统管理员", "admin123")
	seedUser(t, db, "u2", "ops", "普通运维", "opspass1")

	for _, cred := range [][2]string{{"admin", "admin123"}, {"ops", "opspass1"}} {
		token := loginToken(t, db, cred[0], cred[1])
		w := perform(t, r, http.MethodGet, "/api/v1/protected", "", token)
		require.Equal(t, http.StatusOK, w.Code)
		assert.NotEqual(t, http.StatusForbidden, w.Code, "中间件不应返回 403（无授权逻辑）")
	}

	// 无效/缺失 token 也只返回 401，绝不 403。
	w := perform(t, r, http.MethodGet, "/api/v1/protected", "", "bad-token")
	require.Equal(t, http.StatusUnauthorized, w.Code)
	w2 := perform(t, r, http.MethodGet, "/api/v1/protected", "", "")
	require.Equal(t, http.StatusUnauthorized, w2.Code)
}
