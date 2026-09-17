package auth

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ctxUserRouter 把指定用户直接写入 gin context（模拟已经过 AuthMiddleware 的
// 认证用户），再挂 RequireAdmin，用于纯中间件授权语义测试。noContext 为 true 时
// 不注入用户，模拟缺少认证上下文的极端情况。
func ctxUserRouter(u *models.User, noContext bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	chain := []gin.HandlerFunc{}
	if !noContext {
		chain = append(chain, func(c *gin.Context) { c.Set(ContextUserKey, u) })
	}
	chain = append(chain, RequireAdmin())
	chain = append(chain, func(c *gin.Context) { response.OK(c, gin.H{"ok": true}) })
	r.GET("/admin/protected", chain...)
	return r
}

// TestRequireAdmin_AdminAllowed 平台管理员（Role=admin 且 active）放行到 handler。
func TestRequireAdmin_AdminAllowed(t *testing.T) {
	u := &models.User{
		ID: "u1", Username: "admin", DisplayName: "系统管理员",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleAdmin, Status: models.UserStatusActive,
	}
	w := perform(t, ctxUserRouter(u, false), http.MethodGet, "/admin/protected", "", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	env := decodeEnvelope(t, w)
	assert.Equal(t, "success", env.Status)
}

// TestRequireAdmin_RegularUserRejected 普通用户（Role=user）即使已认证也被 403。
func TestRequireAdmin_RegularUserRejected(t *testing.T) {
	u := &models.User{
		ID: "u2", Username: "ops", DisplayName: "普通运维",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleUser, Status: models.UserStatusActive,
	}
	w := perform(t, ctxUserRouter(u, false), http.MethodGet, "/admin/protected", "", "")
	require.Equal(t, http.StatusForbidden, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "forbidden", env.ErrorType)
	assert.Equal(t, "需要管理员权限", env.Error)
}

// TestRequireAdmin_NoUserInContextRejected 缺少认证上下文（未设 authUser）一律 403。
func TestRequireAdmin_NoUserInContextRejected(t *testing.T) {
	w := perform(t, ctxUserRouter(nil, true), http.MethodGet, "/admin/protected", "", "")
	require.Equal(t, http.StatusForbidden, w.Code)
	env := decodeEnvelope(t, w)
	assert.Equal(t, "forbidden", env.ErrorType)
}

// TestRequireAdmin_DisabledAdminRejected 管理员被禁用（非 active）也拒绝。
func TestRequireAdmin_DisabledAdminRejected(t *testing.T) {
	u := &models.User{
		ID: "u1", Username: "admin", DisplayName: "系统管理员",
		TenantID: models.PlatformAdminTenantID,
		Role:     models.UserRoleAdmin, Status: models.UserStatusDisabled,
	}
	w := perform(t, ctxUserRouter(u, false), http.MethodGet, "/admin/protected", "", "")
	require.Equal(t, http.StatusForbidden, w.Code)
	assert.Equal(t, "forbidden", decodeEnvelope(t, w).ErrorType)
}

// TestRequireAdmin_WrongContextTypeRejected context 里的值不是 *models.User 也拒绝。
func TestRequireAdmin_WrongContextTypeRejected(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/admin/protected",
		func(c *gin.Context) { c.Set(ContextUserKey, "not-a-user") },
		RequireAdmin(),
		func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	w := perform(t, r, http.MethodGet, "/admin/protected", "", "")
	require.Equal(t, http.StatusForbidden, w.Code)
	assert.Equal(t, "forbidden", decodeEnvelope(t, w).ErrorType)
}