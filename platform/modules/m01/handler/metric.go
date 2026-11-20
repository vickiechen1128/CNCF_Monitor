package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// MetricHandler exposes the technical metric catalogue (FR-18).
type MetricHandler struct {
	svc *service.MetricService
}

// NewMetricHandler constructs the handler.
func NewMetricHandler(svc *service.MetricService) *MetricHandler {
	return &MetricHandler{svc: svc}
}

// List handles GET /metric-library.
func (h *MetricHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.MetricFilter{
		MetricType:       domain.MetricType(strings.TrimSpace(c.Query("metric_type"))),
		TemplateCode:     strings.TrimSpace(c.Query("template_code")),
		ResourceCategory: domain.ResourceCategory(strings.TrimSpace(c.Query("resource_category"))),
		Category:         strings.TrimSpace(c.Query("category")),
		Enabled:          boolQuery(c, "enabled"),
		Keyword:          strings.TrimSpace(c.Query("keyword")),
		Page:             page,
		PageSize:         pageSize,
	}
	items, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.MetricResponse, 0, len(items))
	for _, item := range items {
		list = append(list, dto.FromMetric(item))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /metric-library.
func (h *MetricHandler) Create(c *gin.Context) {
	var req dto.MetricRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	created, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMetric(created))
}

// Get handles GET /metric-library/{id}.
func (h *MetricHandler) Get(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	item, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMetric(item))
}

// Update handles PUT /metric-library/{id}.
func (h *MetricHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.MetricRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	updated, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMetric(updated))
}

// Delete handles DELETE /metric-library/{id}.
func (h *MetricHandler) Delete(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"id": id})
}
