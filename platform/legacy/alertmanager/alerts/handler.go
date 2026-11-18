package alerts

import (
	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
)

// ListHandler 处理 GET /api/v2/platform/alertmanager/alerts（契约快照 §10.2）：
// 代理 AM GET /api/v2/alerts，响应 data.items 含 notify_status 四态；
// 决策 56 读路径授权过滤由服务端强制注入（MVP 单租户恒通过，骨架保留）；
// network_domain Query 仅作 UX 筛选透传，不构成权限依据；
// AM 不可达 / 非 2xx → internal 可观测错误；空结果返回 [] 而非 null。
func ListHandler(svc *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		scope := authorizedScopeForUser(c)
		items, err := svc.List(c.Request.Context(), scope, c.Query("network_domain"))
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"items": items})
	}
}

// authorizedScopeForUser 构建当前用户授权网域集合（决策 56 读路径骨架）。
// MVP 单租户恒 AllDomains=true（=全部网域，不附加过滤）；未来多租户从认证
// 上下文（auth.ContextUserKey）解析用户授权网域集合，机制保留于此。
// 注意：本函数只读取服务端认证上下文，不信任前端传参。
func authorizedScopeForUser(_ *gin.Context) *models.AuthorizedMatcherScope {
	return &models.AuthorizedMatcherScope{AllDomains: true}
}
