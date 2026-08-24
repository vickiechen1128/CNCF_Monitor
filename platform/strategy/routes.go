// Package strategy 收口 Module_01 监控策略的全部业务路由：ExporterTemplate、
// CITypeExporterMapping、ScrapeJob（含实例候选/安装确认/预览）、MonitoringRule
// （含 validate-yaml）与技术指标库，统一挂在 /api/v2/platform 下，响应统一
// {status, data|errorType, error}。
package strategy

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/strategy/ci-exporter"
	"github.com/metriccenter/metriccenter/platform/strategy/exporter-template"
	"github.com/metriccenter/metriccenter/platform/strategy/metric-library"
	"github.com/metriccenter/metriccenter/platform/strategy/rule"
	"github.com/metriccenter/metriccenter/platform/strategy/scrapejob"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module_01 strategy endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - /exporter-templates          （LIST/CRUD，内置只读）
//   - /ci-exporter-mappings        （LIST/CRUD，is_default 唯一）
//   - /scrape-jobs                 （LIST/CRUD + instance-candidates/instances/confirm/preview-targets）
//   - /monitoring-rules            （LIST/CRUD + validate-yaml）
//   - /metric-library              （LIST/POST/PUT，内置只读）
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	exportertemplate.RegisterRoutes(platform, db)
	ciexporter.RegisterRoutes(platform, db)
	scrapejob.RegisterRoutes(platform, db)
	rule.RegisterRoutes(platform, db)
	metriclibrary.RegisterRoutes(platform, db)
}