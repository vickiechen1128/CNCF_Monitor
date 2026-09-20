package edge

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"

	"gorm.io/gorm"
)

// RegisterManagementRoutes 将 Module_11 管理面接口挂到 /api/v2/platform 直接子组。
// 与 edge 协议组（/edge/*，edge-token 鉴权 + 全局 auth 豁免，D1）分离：本组走全局
// 用户认证（au-02），不附加 edge-token 中间件。
//
//   - DELETE /network-domains/:id/monitor   退纳管（级联清退，决策 D3）
//   - GET    /edge-agents                   采集节点状态列表（§3.2）
//   - GET    /edge-agents/:id               节点详情（含组件清单）
//   - GET    /edge-packages                 离线包清单（§3.3）
//   - GET    /edge-packages/latest/download 下载最新离线包（需认证）
//
// 契约：docs/02-product-requirements/Modules/Module_11_.. §4.2/§6。DELETE monitor 与
// configcenter/domain 已注册的 POST/PUT /network-domains/:id/monitor 仅方法不同，无冲突。
func RegisterManagementRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	platform.DELETE("/network-domains/:id/monitor", RetireDomainHandler(db))

	ag := platform.Group("/edge-agents")
	ag.GET("", ListAgentsHandler(db))
	ag.GET("/:id", GetAgentHandler(db))

	pk := platform.Group("/edge-packages")
	pk.GET("", ListPackagesHandler())
	pk.GET("/latest/download", DownloadLatestPackageHandler())
	// 静态路由 /latest/download 优先于参数路由 /:version/download（Gin 树优先静态节点），
	// 因此 latest 路由行为不变（契约 §2：保留 /latest/download）。
	pk.GET("/:version/download", DownloadPackageHandler())
}

// RetireDomainHandler 处理 DELETE /api/v2/platform/network-domains/:id/monitor。
func RetireDomainHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		dom, err := RetireDomain(db, c.Param("id"))
		if err != nil {
			respondRetireError(c, err)
			return
		}
		response.OK(c, dom)
	}
}

// respondRetireError 将退纳管服务层 sentinel 错误映射为统一响应。
func respondRetireError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrRetireNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrRetireManagementDomain),
		errors.Is(err, ErrRetireAlreadyRetired):
		response.Conflict(c, err)
	case errors.Is(err, ErrRetireNotMonitored):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}

// ListAgentsHandler 处理 GET /api/v2/platform/edge-agents。
func ListAgentsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resp, err := ListAgents(db, time.Now().UTC(), DefaultOfflineThreshold)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, resp)
	}
}

// GetAgentHandler 处理 GET /api/v2/platform/edge-agents/:id。
func GetAgentHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("invalid edge agent id: %s", c.Param("id")))
			return
		}
		v, err := GetAgent(db, uint(id), time.Now().UTC(), DefaultOfflineThreshold)
		if err != nil {
			respondAgentError(c, err)
			return
		}
		response.OK(c, v)
	}
}

// respondAgentError 映射单节点查询错误。
func respondAgentError(c *gin.Context, err error) {
	if errors.Is(err, ErrRetireNotFound) {
		response.NotFound(c, err.Error())
		return
	}
	response.InternalServerError(c, err)
}

// ListPackagesHandler 处理 GET /api/v2/platform/edge-packages。
func ListPackagesHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		pkgs, err := ListPackages()
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, pkgs)
	}
}

// DownloadLatestPackageHandler 处理 GET /api/v2/platform/edge-packages/latest/download。
func DownloadLatestPackageHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		art, err := LatestPackage()
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		servePackageZip(c, art)
	}
}

// DownloadPackageHandler 处理 GET /api/v2/platform/edge-packages/:version/download。
// 未找到指定版本返回 404（契约 §2）。
func DownloadPackageHandler() gin.HandlerFunc {
	return func(c *gin.Context) {
		art, err := FindPackage(c.Param("version"))
		if err != nil {
			if errors.Is(err, ErrPackageNotFound) {
				response.NotFound(c, err.Error())
				return
			}
			response.InternalServerError(c, err)
			return
		}
		servePackageZip(c, art)
	}
}

// servePackageZip 输出离线包 zip（latest 与按版本下载复用同一响应格式）：
// Content-Type application/zip、Content-Disposition、ETag、X-Checksum-Sha256。
func servePackageZip(c *gin.Context, art PackageArtifact) {
	zipData, sha, err := buildOfflinePackageZip(art)
	if err != nil {
		response.InternalServerError(c, err)
		return
	}
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="edge-agent-offline-%s.zip"`, art.Version))
	c.Header("ETag", `"`+sha+`"`)
	c.Header("X-Checksum-Sha256", sha)
	c.Data(http.StatusOK, "application/zip", zipData)
}
