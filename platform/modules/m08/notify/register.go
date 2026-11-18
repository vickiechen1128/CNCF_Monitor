package notify

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"gorm.io/gorm"
)

// RegisterRoutes 挂载 PL-3 通知渠道 / 通知模板管理路由到 /api/v2/platform/alertmanager/*：
//   - /notify-channels*：通知渠道 CRUD——读端点（列表）仅全局认证 au-02，写端点
//     （创建/更新/删除）挂 RequireAdmin 最小授权门（与既有 config / silences 挂法一致）；
//   - /notify-templates*：通知模板列表 / 详情（读）/ 新建 / 编辑 / 删除（写）。
//
// 装配时先收敛历史 append-only 模板留痕（CompactTemplateVersions），再幂等 seed 内置默认模板；
// 两者失败仅记录、不阻断路由。
func RegisterRoutes(am *gin.RouterGroup, db *gorm.DB) {
	if err := CompactTemplateVersions(db); err != nil {
		log.Printf("[notify] compact template versions failed: %v", err)
	}
	if err := EnsureBuiltinTemplates(db); err != nil {
		log.Printf("[notify] seed builtin templates failed: %v", err)
	}

	ch := am.Group("/notify-channels")
	ch.GET("", ListChannelsHandler(db))
	adminCh := ch.Group("")
	adminCh.Use(auth.RequireAdmin())
	adminCh.POST("", CreateChannelHandler(db))
	adminCh.PUT("/:id", UpdateChannelHandler(db))
	adminCh.DELETE("/:id", DeleteChannelHandler(db))

	tpl := am.Group("/notify-templates")
	tpl.GET("", ListTemplatesHandler(db))
	tpl.GET("/:id", GetTemplateHandler(db))
	adminTpl := tpl.Group("")
	adminTpl.Use(auth.RequireAdmin())
	adminTpl.POST("", CreateTemplateHandler(db))
	adminTpl.PUT("/:id", UpdateTemplateHandler(db))
	adminTpl.DELETE("/:id", DeleteTemplateHandler(db))
}