package edge

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
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
//   - GET    /edge-packages                 离线包清单（§3.3，读包目录 release_meta.json）
//   - GET    /edge-packages/latest/download 流式下发最新离线包 tar.gz（需认证）
//
// dir 是离线交付包构建产物目录（含 release_meta.json 与 tar.gz）；未打包时清单为空数组。
//
// 契约：docs/02-product-requirements/Modules/Module_11_.. §4.2/§6。DELETE monitor 与
// configcenter/domain 已注册的 POST/PUT /network-domains/:id/monitor 仅方法不同，无冲突。
func RegisterManagementRoutes(platform *gin.RouterGroup, db *gorm.DB, dir string) {
	platform.DELETE("/network-domains/:id/monitor", RetireDomainHandler(db))

	ag := platform.Group("/edge-agents")
	ag.GET("", ListAgentsHandler(db))
	ag.GET("/:id", GetAgentHandler(db))

	pk := platform.Group("/edge-packages")
	pk.GET("", ListPackagesHandler(dir))
	pk.GET("/latest/download", DownloadLatestPackageHandler(dir))
	// 静态路由 /latest/download 优先于参数路由 /:version/download（Gin 树优先静态节点），
	// 因此 latest 路由行为不变（契约 §2：保留 /latest/download）。
	pk.GET("/:version/download", DownloadPackageHandler(dir))
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
// 读包目录 release_meta.json；未打包时返回空数组 + 200（前端走空态）。
func ListPackagesHandler(dir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		pkgs, err := ListPackages(dir)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, pkgs)
	}
}

// DownloadLatestPackageHandler 处理 GET /api/v2/platform/edge-packages/latest/download。
func DownloadLatestPackageHandler(dir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		art, err := LatestPackage(dir)
		if err != nil {
			if errors.Is(err, ErrNoPackage) {
				response.NotFound(c, err.Error())
				return
			}
			response.InternalServerError(c, err)
			return
		}
		servePackageArtifact(c, dir, art)
	}
}

// DownloadPackageHandler 处理 GET /api/v2/platform/edge-packages/:version/download。
// 未找到指定版本返回 404（契约 §2）。
func DownloadPackageHandler(dir string) gin.HandlerFunc {
	return func(c *gin.Context) {
		art, err := FindPackage(dir, c.Param("version"))
		if err != nil {
			if errors.Is(err, ErrPackageNotFound) {
				response.NotFound(c, err.Error())
				return
			}
			response.InternalServerError(c, err)
			return
		}
		servePackageArtifact(c, dir, art)
	}
}

// servePackageArtifact 流式下发离线包 tar.gz（latest 与按版本下载复用同一响应格式）：
// Content-Type application/gzip、Content-Disposition（用清单里的真实 file 名）、
// ETag / X-Checksum-Sha256（取清单 sha256，不为大包重算）、Content-Length。
// 用 http.ServeContent 打开文件句柄流式输出（顺带支持 Range / If-Modified-Since），
// 避免 os.ReadFile 把整包读进内存。
func servePackageArtifact(c *gin.Context, dir string, art PackageArtifact) {
	f, err := OpenPackageFile(dir, art)
	if err != nil {
		response.InternalServerError(c, err)
		return
	}
	defer func() { _ = f.Close() }()

	info, err := f.Stat()
	if err != nil {
		response.InternalServerError(c, err)
		return
	}

	name := filepath.Base(art.File)
	// 显式设置 Content-Type：.tar.gz 由扩展名推断不稳定（application/gzip 或 x-gzip），
	// 契约要求固定为 application/gzip。显式设置后 http.ServeContent 不再覆盖。
	c.Header("Content-Type", "application/gzip")
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	if art.Sha256 != "" {
		c.Header("ETag", `"`+art.Sha256+`"`)
		c.Header("X-Checksum-Sha256", art.Sha256)
	}
	http.ServeContent(c.Writer, c.Request, name, info.ModTime(), f)
}
