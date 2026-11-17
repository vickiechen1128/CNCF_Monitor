package handler

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// bindJSON decodes a JSON body and rejects malformed payloads.
func bindJSON(c *gin.Context, dest any) error {
	if err := c.ShouldBindJSON(dest); err != nil {
		return fmt.Errorf("请求体不是合法 JSON: %w", err)
	}
	return nil
}

// parsePagination reads page/page_size with the shared defaults.
func parsePagination(c *gin.Context) (int, int) {
	page, pageSize := 1, 20
	if v := strings.TrimSpace(c.Query("page")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			page = parsed
		}
	}
	if v := strings.TrimSpace(c.Query("page_size")); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
			pageSize = parsed
		}
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

// boolQuery returns a tri-state bool query parameter.
func boolQuery(c *gin.Context, key string) *bool {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil
	}
	value := strings.EqualFold(raw, "true") || raw == "1"
	return &value
}

// respondError maps errors onto the envelope, adding the structured
// `data.validation` block for line-level configuration failures (FR-04).
func respondError(c *gin.Context, err error) {
	var validation *domain.ConfigValidationError
	if errors.As(err, &validation) {
		response.BadRequestWithDetails(c, response.ErrorTypeBadRequest, validation, gin.H{
			"validation": gin.H{
				"cause": validation.Cause,
				"note":  validation.Note,
				"items": validation.Items,
			},
		})
		return
	}
	var upstream *domain.UpstreamError
	if errors.As(err, &upstream) {
		response.BadGateway(c, upstream.Err, "上游 Alertmanager 不可达，请确认服务已启动后重试")
		return
	}
	httpapi.WriteError(c, err)
}

// actorOf derives the authorization scope from the authenticated user.
func actorOf(c *gin.Context) domain.Actor {
	user := auth.CurrentUser(c)
	if user == nil {
		return domain.Actor{}
	}
	return domain.Actor{
		Username: auth.CurrentUsername(c), TenantID: user.TenantID,
		IsPlatformAdmin: user.Role == models.UserRoleAdmin,
	}
}

// operatorOf returns the acting username for logs and snapshots.
func operatorOf(c *gin.Context) string { return auth.CurrentUsername(c) }

// parsePathID parses an auto-increment id from the path.
func parsePathID(c *gin.Context, name string) (int64, bool) {
	raw := strings.TrimSpace(c.Param(name))
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, fmt.Errorf("%s 必须是正整数", name))
		return 0, false
	}
	return id, true
}
