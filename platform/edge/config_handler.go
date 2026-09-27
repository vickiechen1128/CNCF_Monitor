package edge

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"

	"gorm.io/gorm"
)

// ConfigService 负责按网域加载最新 ConfigVersion 并产出配置 zip。
type ConfigService struct {
	db *gorm.DB
}

// NewConfigService 构造 ConfigService。
func NewConfigService(db *gorm.DB) *ConfigService { return &ConfigService{db: db} }

// ConfigHandler 处理 GET /edge/config：从网域最新 ConfigVersion 重建 zip 下发。
//
//   - 版本一致（客户端 query `config_version` 或 ETag If-None-Match 等于当前）→ 304
//   - 无任何已确认 ConfigVersion → 404（首拉尚无配置）
//   - 其余 → 200，Content-Type: application/zip，Content-Disposition attachment
func ConfigHandler(svc *ConfigService) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, ok := c.Get(ContextDomainKey)
		if !ok {
			response.Unauthorized(c, "edge identity not established")
			return
		}
		dom := v.(*models.NetworkDomain)

		version, err := svc.latestVersion(dom.ID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if version == nil {
			response.NotFound(c, "no confirmed config version for network domain yet")
			return
		}

		current := configVersionString(version)

		// 304：客户端已持有一致版本。
		clientVersion := c.Query("config_version")
		if clientVersion == "" {
			clientVersion = trimETag(c.GetHeader("If-None-Match"))
		}
		if clientVersion != "" && clientVersion == current {
			c.Status(http.StatusNotModified)
			return
		}

		zipData, _, err := BuildConfigZip(version, dom.AgentType, dom.RemoteWriteURL)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		c.Header("Content-Type", "application/zip")
		c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="edge-config-%s.zip"`, dom.ID))
		c.Header("ETag", `"`+current+`"`)
		c.Header("Cache-Control", "no-cache")
		c.Data(http.StatusOK, "application/zip", zipData)
	}
}

// latestVersion 加载网域最新 ConfigVersion（无则返回 nil）。
func (s *ConfigService) latestVersion(domainID string) (*models.ConfigVersion, error) {
	return latestConfigVersion(s.db, domainID)
}

// trimETag 去除 ETag 首尾引号与 W/ 弱校验前缀。
func trimETag(v string) string {
	v = strings.TrimPrefix(strings.TrimSpace(v), "W/")
	return strings.Trim(strings.TrimSpace(v), `"`)
}

// ErrNoConfigVersion 表示网域尚无已确认配置版本。
var ErrNoConfigVersion = errors.New("no confirmed config version")
