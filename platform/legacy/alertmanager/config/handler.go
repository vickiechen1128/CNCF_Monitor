package config

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// queryPage 解析 page/page_size，带默认与上限（复用 M09 draft handler 约定）。
func queryPage(c *gin.Context) (page, pageSize int) {
	page = 1
	pageSize = 20
	if v := c.Query("page"); v != "" {
		fmt.Sscanf(v, "%d", &page)
	}
	if v := c.Query("page_size"); v != "" {
		fmt.Sscanf(v, "%d", &pageSize)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

// parseID 解析路径参数 id 为 unsigned 版本 ID。
func parseID(c *gin.Context) (uint, error) {
	s := c.Param("id")
	n, err := strconv.ParseUint(s, 10, 32)
	if err != nil || n == 0 {
		return 0, fmt.Errorf("invalid version id: %q", s)
	}
	return uint(n), nil
}

// CurrentHandler 处理 GET /api/v2/platform/alertmanager/config/current（契约 §3）：
// 返回当前生效配置（最近一条 applied 版本）；无则返回 { content: ” }。
func CurrentHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		cur, err := LatestApplied(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if cur == nil {
			cur = &models.AlertmanagerConfigVersion{Content: "", Checksum: "", Status: models.AlertmanagerConfigStatusApplied}
		}
		response.OK(c, cur)
	}
}

// ListVersionsHandler 处理 GET /api/v2/platform/alertmanager/config/versions
// （契约 §3：分页，列表不返回 content）。
func ListVersionsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, pageSize := queryPage(c)
		items, total, err := ListVersions(db, page, pageSize)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if items == nil {
			items = []VersionListItem{}
		}
		response.OK(c, gin.H{"items": items, "total": total})
	}
}

// GetVersionHandler 处理 GET /api/v2/platform/alertmanager/config/versions/{id}
// （契约 §3：返回完整版本详情，含 content 只读视图）。
func GetVersionHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		v, err := GetVersion(db, id)
		if errors.Is(err, ErrVersionNotFound) {
			response.NotFound(c, err.Error())
			return
		}
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, v)
	}
}
