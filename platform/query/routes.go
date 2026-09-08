package query

import (
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes 收口 M02 采集状态路由（决策 47）：
//
//   - GET /targets          代理中心 Prometheus 目标状态（本地过滤 + 补全，T02-01）；
//   - GET /health/coverage  三态聚合（按 resource_id 回连，T02-02）。
//
// 与既有 /api/v1 下的 /query*、/labels、/series 代理及 /health* 路由无路径冲突。
// 挂在全局认证中间件之后（/api/* 须 Bearer token），认证即已满足，仅认证不授权。
func RegisterRoutes(g *gin.RouterGroup, db *gorm.DB, promURL *url.URL) {
	client := &http.Client{Timeout: PrometheusTargetsTimeout}
	g.GET("/targets", TargetsHandler(promURL, client))
	g.GET("/health/coverage", CoverageHandler(db, promURL, client))
}