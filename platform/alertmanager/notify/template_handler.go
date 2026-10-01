package notify

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// toTemplateView 将模板留痕版本转换为响应视图。
func toTemplateView(t *models.NotifyTemplate) TemplateView {
	return TemplateView{
		ID:          strconv.FormatUint(uint64(t.ID), 10),
		Name:        t.Name,
		ChannelType: string(t.ChannelType),
		Content:     t.Content,
		IsBuiltin:   t.IsBuiltin,
		Checksum:    t.Checksum,
		Status:      string(t.Status),
		CreatedAt:   t.CreatedAt.Format(time.RFC3339),
	}
}

// respondTemplateError 将模板服务层错误映射为统一错误响应。校验失败（*config.ErrValidation）
// 返回 bad_request，data 含 { items, note } 行级错误（复用 config 的校验错误视图）。
func respondTemplateError(c *gin.Context, err error) {
	var valErr *config.ErrValidation
	switch {
	case errors.Is(err, ErrTemplateNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrTemplateNameRequired), errors.Is(err, ErrTemplateChannelTypeInvalid), errors.Is(err, ErrTemplateBuiltinNotDeletable):
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
// 返回全部模板留痕版本（含 content，供管理页展示与编辑）。
func ListTemplatesHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := ListTemplates(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		items := make([]TemplateView, 0, len(rows))
		for i := range rows {
			items = append(items, toTemplateView(&rows[i]))
		}
		response.OK(c, gin.H{"items": items, "total": len(items)})
	}
}

// SubmitTemplateHandler 处理 POST /api/v2/platform/alertmanager/notify-templates：
// 校验通过才落库留痕；校验失败只回行级错误、不落库。
func SubmitTemplateHandler(db *gorm.DB) gin.HandlerFunc {
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
		tpl, err := SubmitTemplate(db, SubmitTemplateInput{
			Name:        req.Name,
			ChannelType: req.ChannelType,
			Content:     req.Content,
		})
		if err != nil {
			respondTemplateError(c, err)
			return
		}
		response.OK(c, toTemplateView(tpl))
	}
}

// RemountTemplateHandler 处理 POST /api/v2/platform/alertmanager/notify-templates/{id}/remount：
// 将历史版本内容重新提交（总是写入新留痕）；校验失败不落库。
func RemountTemplateHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		var req struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		tpl, err := RemountTemplate(db, id, req.Name)
		if err != nil {
			respondTemplateError(c, err)
			return
		}
		response.OK(c, toTemplateView(tpl))
	}
}

// DeleteTemplateHandler 处理 DELETE /api/v2/platform/alertmanager/notify-templates/{id}：
// 删除一条自定义模板留痕版本（内置模板禁止删除）。仅管理员（路由组已挂 RequireAdmin）。
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