package edge

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
)

// HeartbeatHandler 处理 POST /edge/heartbeat。请求经 EdgeTokenMiddleware 鉴权，
// 本 handler 从上下文取已鉴权网域并绑定请求体后交给 HeartbeatService。
func HeartbeatHandler(svc *HeartbeatService) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, ok := c.Get(ContextDomainKey)
		if !ok {
			response.Unauthorized(c, "edge identity not established")
			return
		}
		dom := v.(*models.NetworkDomain)

		var req HeartbeatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, err)
			return
		}

		resp, err := svc.Handle(dom, &req, nowUTC())
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, resp)
	}
}
