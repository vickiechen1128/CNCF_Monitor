package config

import (
	"errors"
	"fmt"
	"log"
	"net/http"
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

// SubmitHandler 处理 POST /api/v2/platform/alertmanager/config（契约 §3）：
//
//	body: { content: '<alertmanager.yml 全文>', uploaded_by?: string }
//
// 校验失败返回 bad_request，data 含 { items, note } 行级错误；校验通过
// 写入 AlertmanagerConfigVersion 留痕并触发 M09 管理域变更检测。
func SubmitHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Content    string `json:"content" binding:"required"`
			UploadedBy string `json:"uploaded_by"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}

		v, err := Submit(db, req.Content, req.UploadedBy)
		if err != nil {
			respondSubmitError(c, err)
			return
		}
		// 触发变更检测失败但挂载仍成功：仅记录日志不阻断。
		if errors.Is(err, errChangeTrigger) {
			log.Printf("[alertmanager-config] persist ok but trigger change detect failed: %v", err)
		}
		response.OK(c, v)
	}
}

// CurrentHandler 处理 GET /api/v2/platform/alertmanager/config/current（契约 §3）：
// 返回当前生效配置（最近一条 applied 版本）；无则返回 { content: '' }。
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

// RemountHandler 处理 POST /api/v2/platform/alertmanager/config/versions/{id}/remount
// （契约 §3 / §9.1 P0 回滚动线）：将历史版本内容重新挂载提交，再次走校验 → 留痕 →
// 触发 M09 变更检测，总是写入新版本。返回新生成的版本。
func RemountHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		var req struct {
			UploadedBy string `json:"uploaded_by"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}

		// 先查原版本获取内容。
		old, err := GetVersion(db, id)
		if errors.Is(err, ErrVersionNotFound) {
			response.NotFound(c, err.Error())
			return
		}
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		newV, err := Remount(db, old.Content, req.UploadedBy)
		if err != nil {
			respondSubmitError(c, err)
			return
		}
		if errors.Is(err, errChangeTrigger) {
			log.Printf("[alertmanager-config] remount persist ok but trigger change detect failed: %v", err)
		}
		response.OK(c, newV)
	}
}

// respondSubmitError 将服务层错误映射为统一错误响应（契约 §3：校验失败 bad_request）。
func respondSubmitError(c *gin.Context, err error) {
	var valErr *ErrValidation
	switch {
	case errors.Is(err, ErrEmptyContent):
		response.BadRequest(c, err)
	case errors.As(err, &valErr):
		// 校验失败：bad_request，data 为 { items, note }，不进落库/流水线。
		// （契约 §85：errType bad_request，data 带行级错误集合）。
		c.JSON(http.StatusBadRequest, response.Response{
			Status:    response.StatusError,
			ErrorType: response.ErrorTypeBadRequest,
			Error:     "validation failed",
			Data:      gin.H{"items": valErr.Items, "note": valErr.Note},
		})
	default:
		response.InternalServerError(c, err)
	}
}