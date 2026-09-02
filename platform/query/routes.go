package query

import (
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
)

// RegisterRoutes 收口 M02 采集状态路由（决策 47）：当前注册 GET /targets（代理 + 本地
// 过滤补全，T02-01），T02-02 在 routes.go 中追加 GET /health/coverage 三态聚合。
// 与既有 /api/v1 下的 /query*、/labels、/series 代理及 /health* 路由无路径冲突。
// 挂在全局认证中间件之后（/api/* 须 Bearer token），认证即已满足，仅认证不授权。
func RegisterRoutes(g *gin.RouterGroup, promURL *url.URL) {
	client := &http.Client{Timeout: PrometheusTargetsTimeout}
	g.GET("/targets", TargetsHandler(promURL, client))
}