// Package alertmanager 汇总 Module_08 告警收敛与通知管理的控制面路由装载。
// 统一挂载到 /api/v2/platform/alertmanager/*：
//   - /config*：alertmanager.yml 文件挂载 / 当前生效 / 版本列表与详情 / 重新挂载（M08 config）；
//   - /silences*：静默管理——服务端代理 Alertmanager 原生 /api/v2/silences，
//     写路径带决策 56 matcher 授权收敛（即时生效、不入 M09 流水线，决策 59）。
//
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §6.3 / §9.1 / §9.2；docs/05-execution-records/module-08/api-contract-snapshot.md §3/§4。
package alertmanager

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/alertmanager/silence"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"gorm.io/gorm"
)

// RegisterRoutes 挂载 Module_08 告警收敛路由到 =/api/v2/platform/alertmanager/*。
// amURL 为中心 Alertmanager HTTP 地址（由 main 装配 --alertmanager.url 注入）：
// 静默代理与 AM 配置下发 reload 均依赖它。amURL 非法 / 为空时返回错误，调用方
// （main.setupRouter）据此如实启动失败，避免「静默路由配置缺失却静默可用」。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB, amURL string) error {
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

	// M08 静默管理（契约 §4），代理 Alertmanager 原生 API；写路径带授权收敛。
	proxy, err := silence.NewProxy(amURL)
	if err != nil {
		return fmt.Errorf("init alertmanager silence proxy: %w", err)
	}
	sil := am.Group("/silences")
	silSvc := silence.NewService(proxy)
	// 列表端点保留在根组（仅全局认证 au-02）。
	sil.GET("", silence.ListHandler(silSvc))
	// 静默写操作（创建/删除，破坏性删除）为管理操作，挂 RequireAdmin（security-review B）。
	adminSil := sil.Group("")
	adminSil.Use(auth.RequireAdmin())
	adminSil.POST("", silence.CreateHandler(silSvc))
	adminSil.DELETE("/:silence_id", silence.DeleteHandler(silSvc))
	return nil
}