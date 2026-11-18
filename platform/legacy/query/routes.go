package query

import (
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes 收口 M02 采集状态路由（决策 47）：
//
//   - GET /targets          代理中心 Prometheus 目标状态（本地过滤 + 补全 + F-11
//     融合边缘 vmagent 快照，T02-01）；
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
	g.GET("/targets", TargetsHandler(db, promURL, client))
	g.GET("/health/coverage", CoverageHandler(db, promURL, client))
	g.GET("/alerts", AlertsHandler(db, promURL, client))
	g.GET("/alerts/history", AlertsHistoryHandler(db, promURL, client))
}

// RegisterRuleInspectRoutes 挂载规则编辑期的**只读探查**接口到平台组
// （POST /api/v2/platform/monitoring-rule-labels，2026-10-13）。
//
// 与 M01 规则 CRUD（platform/strategy/rule，注册在 /monitoring-rules*）分开放置，原因有二：
//   - 实现依赖中心 Prometheus 查询代理能力（labels / 注解预览都要实查真实序列），
//     与本包同源，避免把 promURL 依赖穿透到 strategy 包；
//   - 路径**不能**是 /monitoring-rules/inspect-labels——同层已有 /monitoring-rules/:id
//     通配路由，Gin 不允许静态段与通配段并存于同一层级（同类规避见 resource/routes.go
//     的 /os-options 注释）。
func RegisterRuleInspectRoutes(platform *gin.RouterGroup, promURL *url.URL) {
	client := &http.Client{Timeout: PrometheusTargetsTimeout}
	platform.POST("/monitoring-rule-labels", InspectRuleLabelsHandler(promURL, client))
}
