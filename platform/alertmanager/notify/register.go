package notify

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"gorm.io/gorm"
)

// RegisterRoutes 挂载 PL-3 通知渠道 / 通知模板管理路由到 /api/v2/platform/alertmanager/*：
//   - /notify-channels*：通知渠道 CRUD——读端点（列表）仅全局认证 au-02，写端点
//     （创建/更新/删除）与接收人片段生成（内嵌桥令牌）挂 RequireAdmin 最小授权门
//     （与既有 config / silences 挂法一致）；
//   - /notify-templates*：通知模板列表（读）/ 提交（校验通过才落库）/ 回滚（写）。
//
// snippetCfg 为接收人片段生成所需的桥基础地址与令牌（由 main 从监听地址 / 桥令牌推导）。
// 装配时幂等 seed 内置默认模板（EnsureBuiltinTemplates）；seed 失败仅记录、不阻断路由。
func RegisterRoutes(am *gin.RouterGroup, db *gorm.DB, snippetCfg ReceiverSnippetConfig) {
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
	// 接收人配置片段（T08-12）：内嵌平台内网令牌，属敏感凭据，挂 RequireAdmin。
	adminCh.GET("/:id/receiver-snippet", ReceiverSnippetHandler(db, snippetCfg))

	tpl := am.Group("/notify-templates")
	tpl.GET("", ListTemplatesHandler(db))
	adminTpl := tpl.Group("")
	adminTpl.Use(auth.RequireAdmin())
	adminTpl.POST("", SubmitTemplateHandler(db))
	adminTpl.POST("/:id/remount", RemountTemplateHandler(db))
}