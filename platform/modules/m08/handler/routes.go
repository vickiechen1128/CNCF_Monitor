package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// Handlers groups the M08 v3 handlers mounted by RegisterRoutes.
type Handlers struct {
	Config     *ConfigHandler
	Routes     *RouteHandler
	Inhibition *InhibitionHandler
	Channel    *ChannelHandler
	Template   *TemplateHandler
	Silence    *SilenceHandler
	Event      *EventHandler
	Alerts     *AlertsHandler
	Bridge     *BridgeHandler
}

// RegisterRoutes mounts the M08 v3 platform surface (prefix /api/v3/platform).
// Reads require authentication; writes require an administrator. The silence
// audit read is admin-only because it exposes operators and refusal reasons.
func RegisterRoutes(platform *gin.RouterGroup, h Handlers) {
	am := platform.Group("/alertmanager")

	am.GET("/config/versions", h.Config.ListVersions)
	am.GET("/routes", h.Routes.Get)
	am.GET("/inhibitions", h.Inhibition.List)
	am.GET("/notify-channels", h.Channel.List)
	am.GET("/notify-templates", h.Template.List)
	am.GET("/notify-templates/:id", h.Template.Get)
	am.GET("/silences", h.Silence.List)
	am.GET("/silences/label-options", h.Silence.LabelOptions)
	am.GET("/alert-events", h.Event.List)
	am.GET("/alert-events/current", h.Event.Current)
	am.GET("/alert-events/stats", h.Event.Stats)
	am.GET("/alerts", h.Alerts.List)

	admin := am.Group("")
	admin.Use(auth.RequireAdmin())
	admin.GET("/config", h.Config.Current)
	admin.GET("/config/versions/:id", h.Config.GetVersion)
	admin.GET("/config/reload-logs", h.Config.ReloadLogs)
	admin.POST("/config/reload", h.Config.Reload)
	admin.POST("/routes", h.Routes.Save)

	admin.POST("/inhibitions", h.Inhibition.Create)
	admin.PUT("/inhibitions/:id", h.Inhibition.Update)
	admin.PATCH("/inhibitions/:id/status", h.Inhibition.SetStatus)
	admin.DELETE("/inhibitions/:id", h.Inhibition.Delete)

	admin.POST("/notify-channels", h.Channel.Create)
	admin.PUT("/notify-channels/:id", h.Channel.Update)
	admin.DELETE("/notify-channels/:id", h.Channel.Delete)

	admin.POST("/notify-templates", h.Template.Create)
	admin.PUT("/notify-templates/:id", h.Template.Update)
	admin.DELETE("/notify-templates/:id", h.Template.Delete)

	admin.POST("/silences", h.Silence.Create)
	admin.DELETE("/silences/:silence_id", h.Silence.Delete)
	admin.GET("/silence-audits", h.Silence.Audits)
}

// RegisterWebhookRoutes mounts the Alertmanager callbacks. Callers must add
// "/api/v3/platform/webhooks/" to auth.PublicPathPrefixes.
func RegisterWebhookRoutes(platform *gin.RouterGroup, h Handlers) {
	webhooks := platform.Group("/webhooks")
	webhooks.POST("/notify", h.Bridge.Notify)
	webhooks.POST("/alerts", h.Bridge.AlertsWebhook)
}
