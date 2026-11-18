package handler

import (
	"context"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// requestContext enriches the request context with the session actor so the
// service layer can enforce tenant ownership (SRS JG v1.2 FR-JG-13). Without an
// authenticated user the context stays as-is; handlers are mounted behind the
// auth middleware in production.
func requestContext(c *gin.Context) context.Context {
	ctx := c.Request.Context()
	user := auth.CurrentUser(c)
	if user == nil || user.TenantID == "" {
		return ctx
	}
	return service.WithActor(ctx, service.Actor{
		TenantID:        user.TenantID,
		IsPlatformAdmin: user.TenantID == models.PlatformAdminTenantID,
	})
}
