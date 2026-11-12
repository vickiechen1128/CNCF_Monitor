package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// Handlers groups the M09 v3 HTTP handlers mounted by RegisterPlatformRoutes
// and RegisterEdgeRoutes. Later batches (B5–B7) add snapshot, package and query
// handlers.
type Handlers struct {
	Onboarding *OnboardingHandler
	Edge       *EdgeHandler
	Agents     *AgentHandler
	Snapshots  *SnapshotHandler
	Query      *QueryHandler
	Packages   *PackageHandler
	// EdgeAuth validates edge bearer tokens (nil falls back to reject-all).
	EdgeAuth TokenValidator
}

// RegisterPlatformRoutes mounts M09 v3 administrative routes under the given
// platform group (expected prefix: /api/v3/platform).
//
// D32: GET /network-domains and GET /network-domains/:id moved here from m06;
// they now return the enriched onboarding view (administrative fields + M09
// runtime state). Mutations stay under RequireAdmin.
func RegisterPlatformRoutes(platform *gin.RouterGroup, h Handlers) {
	platform.GET("/network-domains", h.Onboarding.List)
	platform.GET("/network-domains/:id", h.Onboarding.Get)

	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	admin.POST("/network-domains/:id/monitor", h.Onboarding.Monitor)
	admin.DELETE("/network-domains/:id/monitor", h.Onboarding.Unmonitor)
	admin.POST("/network-domains/:id/token/reset", h.Onboarding.ResetToken)

	// 采集节点（契约 §3）
	platform.GET("/edge-agents", h.Agents.List)
	platform.GET("/edge-agents/:id", h.Agents.Get)
	admin.PUT("/edge-agents/:id/restart", h.Agents.Restart)
	admin.PUT("/edge-agents/:id/flush-backlog", h.Agents.FlushBacklog)

	// 配置快照只读历史（契约 §4）—— B5；无 confirm/rollback/deployments 端点（D25）
	platform.GET("/network-domains/:id/config-snapshots", h.Snapshots.List)
	platform.GET("/network-domains/:id/config-snapshots/:snapshot_id", h.Snapshots.Get)
	admin.GET("/network-domains/:id/config-snapshots/:snapshot_id/content", h.Snapshots.Content)

	// 离线包（契约 §5）
	platform.GET("/edge-packages", h.Packages.List)
	platform.GET("/edge-packages/latest", h.Packages.Latest)
	platform.GET("/edge-packages/:file", h.Packages.Download)
}

// RegisterEdgeRoutes mounts the machine-to-machine edge protocol under the
// given edge group (expected prefix: /api/v3/edge). The group is authenticated
// by EdgeTokenMiddleware only; the global user AuthMiddleware is bypassed via
// auth.PublicPathPrefixes (wired in v3.go / main.go) per D27.
func RegisterEdgeRoutes(edge *gin.RouterGroup, h Handlers) {
	edge.Use(EdgeTokenMiddleware(h.EdgeAuth))
	edge.POST("/heartbeat", h.Edge.Heartbeat)
	edge.GET("/config", h.Edge.Config)
}
