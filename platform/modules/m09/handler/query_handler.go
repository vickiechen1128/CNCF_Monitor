package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// QueryHandler exposes the Prometheus-compatible query surface (/api/v1/*).
type QueryHandler struct {
	svc *service.QueryService
}

// NewQueryHandler constructs the query handler.
func NewQueryHandler(svc *service.QueryService) *QueryHandler {
	return &QueryHandler{svc: svc}
}

// Query handles GET/POST /api/v1/query.
func (h *QueryHandler) Query(c *gin.Context) {
	h.proxy(c, "/api/v1/query")
}

// QueryRange handles GET/POST /api/v1/query_range.
func (h *QueryHandler) QueryRange(c *gin.Context) {
	h.proxy(c, "/api/v1/query_range")
}

// Labels handles GET /api/v1/labels.
func (h *QueryHandler) Labels(c *gin.Context) {
	h.proxy(c, "/api/v1/labels")
}

// LabelValues handles GET /api/v1/label/:name/values.
func (h *QueryHandler) LabelValues(c *gin.Context) {
	name := url.PathEscape(c.Param("name"))
	h.proxy(c, "/api/v1/label/"+name+"/values")
}

// Series handles GET /api/v1/series.
func (h *QueryHandler) Series(c *gin.Context) {
	h.proxy(c, "/api/v1/series")
}

// Alerts handles GET /api/v1/alerts.
func (h *QueryHandler) Alerts(c *gin.Context) {
	h.proxy(c, "/api/v1/alerts")
}

// Targets handles GET /api/v1/targets.
func (h *QueryHandler) Targets(c *gin.Context) {
	page, pageSize := parsePagination(c)
	items, total, err := h.svc.Targets(c.Request.Context(), actorOf(c), repository.TargetFilter{
		NetworkDomainID: strings.TrimSpace(c.Query("network_domain")),
		Job:             strings.TrimSpace(c.Query("job")),
		Health:          strings.TrimSpace(c.Query("health")),
		Keyword:         strings.TrimSpace(c.Query("keyword")),
		Page:            page,
		PageSize:        pageSize,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.TargetResponse, 0, len(items))
	for i := range items {
		list = append(list, dto.FromEdgeTarget(&items[i]))
	}
	response.OK(c, dto.ListTargetsResponse{List: list, Total: total, Page: page, PageSize: pageSize})
}

// Coverage handles GET /api/v1/health/coverage. It returns the per-resource
// items plus the aggregate summary (contract §7.2); the three legacy top-level
// counters stay for the M07 badge consumer during the compatibility window.
func (h *QueryHandler) Coverage(c *gin.Context) {
	state := strings.TrimSpace(c.Query("state"))
	if state != "" && !validCoverageState(state) {
		response.BadRequest(c, fmt.Errorf(
			"state: invalid value %q: must be collecting, partial_collecting, pending_down or not_monitored", state))
		return
	}
	category := strings.TrimSpace(c.Query("resource_category"))
	if category != "" && !validResourceCategory(category) {
		response.BadRequest(c, fmt.Errorf(
			"resource_category: invalid value %q: must be host, database, middleware, application, generic_target or interface_service", category))
		return
	}
	page, pageSize := parseCoveragePagination(c)
	filter := repository.CoverageFilter{
		NetworkDomainID:  strings.TrimSpace(c.Query("network_domain")),
		ResourceCategory: category,
	}
	report, err := h.svc.CoverageReport(c.Request.Context(), actorOf(c), filter, state, page, pageSize)
	if err != nil {
		respondError(c, err)
		return
	}
	counts, err := h.svc.Coverage(c.Request.Context(), actorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromCoverageReport(report, counts))
}

// parseCoveragePagination parses the coverage page params: page defaults to 1,
// page_size defaults to 500 and is capped at 1000 (contract §7.2).
func parseCoveragePagination(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize < 1 {
		pageSize = 500
	}
	if pageSize > 1000 {
		pageSize = 1000
	}
	return page, pageSize
}

func validCoverageState(state string) bool {
	switch state {
	case service.StateCollecting, service.StatePartialCollecting,
		service.StatePendingDown, service.StateNotMonitored:
		return true
	default:
		return false
	}
}

func validResourceCategory(category string) bool {
	switch category {
	case "host", "database", "middleware", "application", "generic_target", "interface_service":
		return true
	default:
		return false
	}
}

func (h *QueryHandler) proxy(c *gin.Context, path string) {
	status, body, meta, err := h.svc.Proxy(c.Request.Context(), actorOf(c), path, mergedParams(c))
	if err != nil {
		var upstream *service.UpstreamError
		if errors.As(err, &upstream) {
			response.BadGateway(c, upstream.Err, "中心 Prometheus 不可达，请稍后重试")
			return
		}
		respondError(c, err)
		return
	}
	if status != http.StatusOK {
		c.Data(status, "application/json", body)
		return
	}
	var payload struct {
		Status string          `json:"status"`
		Data   json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || len(payload.Data) == 0 {
		c.Data(http.StatusOK, "application/json", body)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"status": payload.Status,
		"data":   payload.Data,
		"meta":   meta,
	})
}

// mergedParams combines URL query and POST form values (Prometheus accepts both).
func mergedParams(c *gin.Context) url.Values {
	_ = c.Request.ParseForm()
	out := make(url.Values)
	for key, list := range c.Request.URL.Query() {
		out[key] = append([]string(nil), list...)
	}
	for key, list := range c.Request.PostForm {
		out[key] = append([]string(nil), list...)
	}
	return out
}

// RegisterQueryRoutes mounts the Prometheus-compatible query surface. It is
// wired only in v3-only mode to avoid clashing with the legacy v2 proxy during
// the compatibility window (D30).
func RegisterQueryRoutes(apiV1 *gin.RouterGroup, h *QueryHandler) {
	apiV1.GET("/query", h.Query)
	apiV1.POST("/query", h.Query)
	apiV1.GET("/query_range", h.QueryRange)
	apiV1.POST("/query_range", h.QueryRange)
	apiV1.GET("/labels", h.Labels)
	apiV1.GET("/label/:name/values", h.LabelValues)
	apiV1.GET("/series", h.Series)
	apiV1.GET("/alerts", h.Alerts)
	apiV1.GET("/targets", h.Targets)
	apiV1.GET("/health/coverage", h.Coverage)
}
