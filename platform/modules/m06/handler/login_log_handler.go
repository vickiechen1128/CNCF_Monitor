package handler

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m06/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// LoginLogHandler exposes the read-only login-log API.
type LoginLogHandler struct {
	svc *service.LoginLogService
}

// NewLoginLogHandler constructs a login-log handler.
func NewLoginLogHandler(svc *service.LoginLogService) *LoginLogHandler {
	return &LoginLogHandler{svc: svc}
}

// List handles GET /login-logs.
func (h *LoginLogHandler) List(c *gin.Context) {
	var success *bool
	if raw := strings.TrimSpace(c.Query("success")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			response.BadRequest(c, fmt.Errorf(`invalid success filter: must be "true" or "false"`))
			return
		}
		success = &value
	}
	startTime, err := parseRFC3339Query(c, "start_time")
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	endTime, err := parseRFC3339Query(c, "end_time")
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	page, pageSize := parsePagination(c)
	logs, total, err := h.svc.List(c.Request.Context(), repository.ListLoginLogsFilter{
		Username:  strings.TrimSpace(c.Query("username")),
		Success:   success,
		StartTime: startTime,
		EndTime:   endTime,
		Page:      page,
		PageSize:  pageSize,
	})
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	list := make([]dto.LoginLogResponse, 0, len(logs))
	for _, log := range logs {
		list = append(list, dto.FromLoginLog(log))
	}
	response.OK(c, dto.ListLoginLogsResponse{List: list, Total: total, Page: page, PageSize: pageSize})
}

func parseRFC3339Query(c *gin.Context, key string) (*time.Time, error) {
	raw := strings.TrimSpace(c.Query(key))
	if raw == "" {
		return nil, nil
	}
	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("%s must be RFC3339 (e.g. 2026-11-11T00:00:00Z)", key)
	}
	return &value, nil
}
