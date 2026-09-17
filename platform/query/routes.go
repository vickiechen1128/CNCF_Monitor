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
//   - GET /health/coverage  三态聚合（按 resource_id 回连，T02-02）；
//   - GET /alerts           代理中心 Prometheus 当前触发告警（firing/pending 字段子集 +
//     network_domain 本地过滤，T08-06，契约快照 §10.1）；
//   - GET /alerts/history   基于 ALERTS 时间序列 query_range 重建规则级触发/恢复区间
//     （M02 v1.13 + M08 v1.13，Track B+）。
//
// 与既有 /api/v1 下的 /query*、/labels、/series 代理及 /health* 路由无路径冲突。
// 挂在全局认证中间件之后（/api/* 须 Bearer token），认证即已满足，仅认证不授权。
func RegisterRoutes(g *gin.RouterGroup, db *gorm.DB, promURL *url.URL) {
	client := &http.Client{Timeout: PrometheusTargetsTimeout}
	g.GET("/targets", TargetsHandler(promURL, client))
	g.GET("/health/coverage", CoverageHandler(db, promURL, client))
	g.GET("/alerts", AlertsHandler(db, promURL, client))
	g.GET("/alerts/history", AlertsHistoryHandler(db, promURL, client))
}