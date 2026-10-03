// Package alertmanager 汇总 Module_08 告警收敛与通知管理的控制面路由装载。
// 统一挂载到 /api/v2/platform/alertmanager/*：
//   - /config*：alertmanager.yml 文件挂载 / 当前生效 / 版本列表与详情 / 重新挂载（M08 config）；
//   - /silences*：静默管理——服务端代理 Alertmanager 原生 /api/v2/silences，
//     写路径带决策 56 matcher 授权收敛（即时生效、不入 M09 流水线，决策 59）；
//   - /alerts：通知状态查看——服务端代理 Alertmanager 原生 /api/v2/alerts（v2 口径，
//     决策 61），notify_status 四态归一 + 决策 56 读路径授权过滤骨架（T08-07，契约 §10.2）。
//
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §6.3 / §9.1 / §9.2；docs/05-execution-records/module-08/api-contract-snapshot.md §3/§4/§10。
package alertmanager

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/alerts"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/alertmanager/notify"
	"github.com/metriccenter/metriccenter/platform/alertmanager/route"
	"github.com/metriccenter/metriccenter/platform/alertmanager/silence"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"gorm.io/gorm"
)

// RegisterRoutes 挂载 Module_08 告警收敛路由到 =/api/v2/platform/alertmanager/*。
// amURL 为中心 Alertmanager HTTP 地址（由 main 装配 --alertmanager.url 注入）：
// 静默代理与 AM 配置下发 reload 均依赖它。amURL 非法 / 为空时返回错误，调用方
// （main.setupRouter）据此如实启动失败，避免「静默路由配置缺失却静默可用」。
// notifyCfg 为 PL-3 接收人配置片段生成所需配置（桥基础地址 + 内网令牌，由 main 推导）。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB, amURL string, notifyCfg notify.ReceiverSnippetConfig) error {
	am := platform.Group("/alertmanager")

	// M08 alertmanager.yml 文件挂载（契约 §3）：留痕版本自身已校验（决策 60 校验失败不落库）。
	cfg := am.Group("/config")
	// 列表端点不含 content，保留在根组（仅全局认证 au-02）。
	cfg.GET("/versions", config.ListVersionsHandler(db))
	// 写端点（提交/重挂）与返回完整内容（含凭据明文：basic_auth / bearer_token）的读端点
	// （current / 版本详情）统一挂 RequireAdmin 最小授权门（security-review B/C：管理类
	// 写接口仅认证不授权；告警配置为管理事务）。严格复用 main.go /users /tenants 的挂法。
	adminCfg := cfg.Group("")
	adminCfg.Use(auth.RequireAdmin())
	adminCfg.POST("", config.SubmitHandler(db))
	adminCfg.GET("/current", config.CurrentHandler(db))
	adminCfg.GET("/versions/:id", config.GetVersionHandler(db))
	adminCfg.POST("/versions/:id/remount", config.RemountHandler(db))
	// C1：route 保存合并基 = 当前生效产品视图 alertmanager.yml（含平台物化 receivers），
	// 供前端仅覆盖 route 段、保留平台 receivers（RequireAdmin，内容含出站凭据，与 /current 同级）。
	adminCfg.GET("/product", route.EffectiveAlertmanagerYAMLHandler(db))

	// M08 静默管理（契约 §4），代理 Alertmanager 原生 API；写路径带授权收敛。
	proxy, err := silence.NewProxy(amURL)
	if err != nil {
		return fmt.Errorf("init alertmanager silence proxy: %w", err)
	}
	sil := am.Group("/silences")
	silSvc := silence.NewService(proxy)
	// 列表端点保留在根组（仅全局认证 au-02）。
	sil.GET("", silence.ListHandler(silSvc))
	// matcher 标签选项聚合（契约 §4 / 决策 71）：只读、本地 DB 聚合（不代理 AM），
	// 供创建静默表单做分组联想；挂根组（仅全局认证，同静默列表挂法）。
	sil.GET("/label-options", silence.LabelOptionsHandler(db))
	// 静默写操作（创建/删除，破坏性删除）为管理操作，挂 RequireAdmin（security-review B）。
	adminSil := sil.Group("")
	adminSil.Use(auth.RequireAdmin())
	adminSil.POST("", silence.CreateHandler(silSvc))
	adminSil.DELETE("/:silence_id", silence.DeleteHandler(silSvc))

	// M08 告警状态查看（T08-07，契约 §10.2）：代理 Alertmanager GET /api/v2/alerts，
	// notify_status 四态归一 + 决策 56 读路径授权过滤骨架；db 用于按 resource_id
	// 批量只读回连 M01 五类资源表回填实例名字段（v1.15 决策 70）。只读端点保留在根组
	// （仅全局认证，同静默列表挂法）。
	alertsProxy, err := alerts.NewProxy(amURL)
	if err != nil {
		return fmt.Errorf("init alertmanager alerts proxy: %w", err)
	}
	am.GET("/alerts", alerts.ListHandler(alerts.NewService(alertsProxy, db)))

	// M08 PL-3 通知渲染桥（设计提案 §3.3.8）：通知渠道 CRUD + 通知模板提交/回滚。
	// 读端点挂根组（仅全局认证），写端点与接收人片段生成挂 RequireAdmin（与 config / silences 一致）。
	notify.RegisterRoutes(am, db, notifyCfg)

	// M08 最小运行骨架自动布缆（T08-11，决策 113 口径 C）：默认接收人设定读写。
	// GET（读派生生效态）保留在根组（仅全局认证，同 notify 读端点挂法）；PUT（改写设定并
	// 触发重算 + 自动下发）为管理写操作，挂 RequireAdmin（与 config / silences / notify 一致）。
	rs := am.Group("/route-setting")
	rs.GET("", route.GetRouteSettingHandler(db))
	adminRS := rs.Group("")
	adminRS.Use(auth.RequireAdmin())
	adminRS.PUT("", route.PutRouteSettingHandler(db))
	// M08 route 前台化 v0.3-a 只读渲染（T08-12）：GET /routes，仅全局认证、只读、无写能力
	// （鉴权面不扩张）；响应不返回桥令牌等敏感值（receiver 出站地址脱敏）。与 /route-setting
	// 并列——后者为「默认接收人设定」读写，本端点为「路由树只读视图」。
	am.GET("/routes", route.ListRoutesHandler(db))
	return nil
}