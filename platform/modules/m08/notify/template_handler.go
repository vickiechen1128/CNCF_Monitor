package notify

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"gorm.io/gorm"
)

// respondTemplateError 将模板服务层错误映射为统一错误响应。校验失败（*config.ErrValidation）
// 返回 bad_request，data 含 { items, note } 行级错误（复用 config 的校验错误视图）。
func respondTemplateError(c *gin.Context, err error) {
	var valErr *config.ErrValidation
	var inUse *ErrTemplateInUse
	switch {
	case errors.Is(err, ErrTemplateNotFound):
		response.NotFound(c, err.Error())
	case errors.As(err, &inUse), errors.Is(err, ErrTemplateNameConflict):
		response.Conflict(c, err)
	case errors.Is(err, ErrTemplateNameRequired),
		errors.Is(err, ErrTemplateChannelTypeInvalid),
		errors.Is(err, ErrTemplateChannelTypeImmutable),
		errors.Is(err, ErrTemplateBuiltinNotDeletable),
		errors.Is(err, ErrTemplateBuiltinNotEditable):
		response.BadRequest(c, err)
	case errors.As(err, &valErr):
		c.JSON(http.StatusBadRequest, response.Response{
			Status:    response.StatusError,
			ErrorType: response.ErrorTypeBadRequest,
			Error:     "validation failed",
			Data:      gin.H{"items": valErr.Items, "note": valErr.Note, "cause": string(valErr.Cause)},
		})
	default:
		response.InternalServerError(c, err)
	}
}

// ListTemplatesHandler 处理 GET /api/v2/platform/alertmanager/notify-templates：
// 返回模板清单（不含 content），可选 ?channel_type=feishu|dingtalk|wecom 过滤。
func ListTemplatesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := ListTemplates(db, c.Query("channel_type"))
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"items": rows, "total": len(rows)})
	}
}

// GetTemplateHandler 处理 GET /api/v2/platform/alertmanager/notify-templates/{id}：
// 返回模板详情（含 content 与绑定渠道数），供查看 / 编辑 / 复制。
func GetTemplateHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		tpl, err := GetTemplate(db, id)
		if err != nil {
			respondTemplateError(c, err)
			return
		}
		bound, err := templateBoundChannelCount(db, id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, toTemplateDetail(tpl, bound))
	}
}

// CreateTemplateHandler 处理 POST /api/v2/platform/alertmanager/notify-templates：
// 新建自定义模板；校验通过才落库，校验失败只回行级错误、不落库。
func CreateTemplateHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name        string `json:"name" binding:"required"`
			ChannelType string `json:"channel_type" binding:"required"`
			Content     string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		tpl, err := CreateTemplate(db, CreateTemplateInput{
			Name:        req.Name,
			ChannelType: req.ChannelType,
			Content:     req.Content,
		})
		if err != nil {
			respondTemplateError(c, err)
			return
		}
		response.OK(c, toTemplateDetail(tpl, 0))
	}
}

// UpdateTemplateHandler 处理 PUT /api/v2/platform/alertmanager/notify-templates/{id}：
// 编辑自定义模板（内置模板拒绝）。校验通过才落库，校验失败不落库。
func UpdateTemplateHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		var req struct {
			Name        string `json:"name" binding:"required"`
			ChannelType string `json:"channel_type"`
			Content     string `json:"content" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		tpl, err := UpdateTemplate(db, id, UpdateTemplateInput{
			Name:        req.Name,
			ChannelType: req.ChannelType,
			Content:     req.Content,
		})
		if err != nil {
			respondTemplateError(c, err)
			return
		}
		bound, err := templateBoundChannelCount(db, tpl.ID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, toTemplateDetail(tpl, bound))
	}
}

// DeleteTemplateHandler 处理 DELETE /api/v2/platform/alertmanager/notify-templates/{id}：
// 删除一条自定义模板（内置模板 / 被渠道绑定的模板拒绝）。仅管理员（路由组已挂 RequireAdmin）。
func DeleteTemplateHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		if err := DeleteTemplate(db, id); err != nil {
			respondTemplateError(c, err)
			return
		}
		response.OK(c, gin.H{"id": strconv.FormatUint(uint64(id), 10)})
	}
}
