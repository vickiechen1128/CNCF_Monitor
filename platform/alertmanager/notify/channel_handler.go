package notify

import (
	"errors"
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"gorm.io/gorm"
)

// parseID 解析路径参数 :id 为无符号 ID；非法返回错误。
func parseID(c *gin.Context) (uint, error) {
	s := c.Param("id")
	n, err := strconv.ParseUint(s, 10, 32)
	if err != nil || n == 0 {
		return 0, fmt.Errorf("非法 ID: %q", s)
	}
	return uint(n), nil
}

// respondChannelError 将渠道服务层错误映射为统一错误响应。
func respondChannelError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrChannelNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrChannelNameRequired), errors.Is(err, ErrChannelTypeInvalid), errors.Is(err, ErrChannelWebhookInvalid),
		errors.Is(err, ErrReceiverNameInvalid):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}

// ListChannelsHandler 处理 GET /api/v2/platform/alertmanager/notify-channels：
// 返回全部渠道（响应脱敏，不回显 secret / 完整 webhook_url）。
func ListChannelsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := ListChannels(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		items := make([]ChannelView, 0, len(rows))
		for i := range rows {
			items = append(items, ToChannelView(&rows[i]))
		}
		response.OK(c, gin.H{"items": items})
	}
}

// CreateChannelHandler 处理 POST /api/v2/platform/alertmanager/notify-channels。
func CreateChannelHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			Name       string `json:"name" binding:"required"`
			Type       string `json:"type" binding:"required"`
			WebhookURL string `json:"webhook_url" binding:"required"`
			Secret     string `json:"secret"`
			Enabled    *bool  `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		ch, err := CreateChannel(db, ChannelInput{
			Name:       req.Name,
			Type:       req.Type,
			WebhookURL: req.WebhookURL,
			Secret:     req.Secret,
			Enabled:    req.Enabled,
		})
		if err != nil {
			respondChannelError(c, err)
			return
		}
		response.OK(c, ToChannelView(ch))
	}
}

// UpdateChannelHandler 处理 PUT /api/v2/platform/alertmanager/notify-channels/{id}。
func UpdateChannelHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		var req struct {
			Name       *string `json:"name"`
			Type       *string `json:"type"`
			WebhookURL *string `json:"webhook_url"`
			Secret     *string `json:"secret"`
			Enabled    *bool   `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		ch, err := UpdateChannel(db, id, UpdateChannelInput{
			Name:       req.Name,
			Type:       req.Type,
			WebhookURL: req.WebhookURL,
			Secret:     req.Secret,
			Enabled:    req.Enabled,
		})
		if err != nil {
			respondChannelError(c, err)
			return
		}
		response.OK(c, ToChannelView(ch))
	}
}

// DeleteChannelHandler 处理 DELETE /api/v2/platform/alertmanager/notify-channels/{id}。
func DeleteChannelHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		if err := DeleteChannel(db, id); err != nil {
			respondChannelError(c, err)
			return
		}
		response.OK(c, gin.H{"id": strconv.FormatUint(uint64(id), 10)})
	}
}