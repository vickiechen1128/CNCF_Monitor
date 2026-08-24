// routes.go 收口 Module_01 MonitoringRule（规则挂载）的全部 HTTP 路由：列表 /
// CRUD / validate-yaml，统一挂在 /api/v2/platform/monitoring-rules* 下，
// 响应统一 {status, data|errorType, error}。
package rule

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module_01 monitoring-rule endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST            /monitoring-rules
//   - PUT/DELETE          /monitoring-rules/:id
//   - POST                /monitoring-rules/:id/validate-yaml
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	rules := platform.Group("/monitoring-rules")
	{
		rules.GET("", ListMonitoringRules(db))
		rules.POST("", CreateMonitoringRule(db))
		rules.PUT("/:id", UpdateMonitoringRule(db))
		rules.DELETE("/:id", DeleteMonitoringRule(db))
		rules.POST("/:id/validate-yaml", ValidateRuleYAML(db))
	}
}