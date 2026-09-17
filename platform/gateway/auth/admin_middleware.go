package auth

import (
	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
)

// RequireAdmin returns a middleware that authorizes the current (already
// authenticated, per au-02 AuthMiddleware) user to proceed only when they are
// the platform admin (Role==admin) AND still active. 这是决策 44「无角色/权限点
// 体系」下的最小授权加固（H-2）：/users*、/tenants* 等管理接口挂载本中间件，
// 普通用户 / 匿名 / 非 active 一律 403 拒绝。
//
// 依赖：调用方必须先经过 AuthMiddleware，把 *models.User 存入 gin context 的
// ContextUserKey；否则视为未授权上下文，直接 403。
func RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		u, ok := c.Get(ContextUserKey)
		if !ok {
			response.Forbidden(c, "需要管理员权限")
			c.Abort()
			return
		}
		user, ok := u.(*models.User)
		if !ok || user.Role != models.UserRoleAdmin || user.Status != models.UserStatusActive {
			response.Forbidden(c, "需要管理员权限")
			c.Abort()
			return
		}
		c.Next()
	}
}