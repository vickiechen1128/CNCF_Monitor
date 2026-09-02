// Package alertmanager 汇总 Module_08 告警收敛与通知管理的控制面路由装载。
// 统一挂载到 /api/v2/platform/alertmanager/*：
//   - /config*：alertmanager.yml 文件挂载 / 当前生效 / 版本列表与详情 / 重新挂载（M08 config）；
//   - /silences*：静默管理——服务端代理 Alertmanager 原生 /api/v1/silences，
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
	cfg.POST("", config.SubmitHandler(db))
	cfg.GET("/current", config.CurrentHandler(db))
	cfg.GET("/versions", config.ListVersionsHandler(db))
	cfg.GET("/versions/:id", config.GetVersionHandler(db))
	cfg.POST("/versions/:id/remount", config.RemountHandler(db))

	// M08 静默管理（契约 §4），代理 Alertmanager 原生 API；写路径带授权收敛。
	proxy, err := silence.NewProxy(amURL)
	if err != nil {
		return fmt.Errorf("init alertmanager silence proxy: %w", err)
	}
	sil := am.Group("/silences")
	silSvc := silence.NewService(proxy)
	sil.GET("", silence.ListHandler(silSvc))
	sil.POST("", silence.CreateHandler(silSvc))
	sil.DELETE("/:silence_id", silence.DeleteHandler(silSvc))
	return nil
}