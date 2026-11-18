// routes.go 收口 Module_01 技术指标库（ExporterMetricLibrary）的全部 HTTP 路由：
// 列表 / 用户扩展创建 / 更新（内置只读），统一挂在 /api/v2/platform/metric-library*
// 下，响应统一 {status, data|errorType, error}。
package metriclibrary

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module_01 metric-library endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST  /metric-library
//   - PUT       /metric-library/:metric_id
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	library := platform.Group("/metric-library")
	{
		library.GET("", ListMetricLibrary(db))
		library.POST("", CreateMetricLibrary(db))
		library.PUT("/:metric_id", UpdateMetricLibrary(db))
	}
}