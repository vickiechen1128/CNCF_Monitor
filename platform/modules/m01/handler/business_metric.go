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

// BusinessMetricHandler exposes the business metric catalogue (FR-19).
type BusinessMetricHandler struct {
	svc *service.BusinessMetricService
}

// NewBusinessMetricHandler constructs the handler.
func NewBusinessMetricHandler(svc *service.BusinessMetricService) *BusinessMetricHandler {
	return &BusinessMetricHandler{svc: svc}
}

// List handles GET /business-metrics.
func (h *BusinessMetricHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.BusinessMetricFilter{
		BusinessDomain: strings.TrimSpace(c.Query("business_domain")),
		Status:         domain.BusinessMetricStatus(strings.TrimSpace(c.Query("status"))),
		Owner:          strings.TrimSpace(c.Query("owner")),
		Keyword:        strings.TrimSpace(c.Query("keyword")),
		Page:           page,
		PageSize:       pageSize,
	}
	items, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.BusinessMetricResponse, 0, len(items))
	for _, item := range items {
		list = append(list, dto.FromBusinessMetric(item))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /business-metrics.
func (h *BusinessMetricHandler) Create(c *gin.Context) {
	var req dto.BusinessMetricRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	created, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromBusinessMetric(created))
}

// Get handles GET /business-metrics/{id}.
func (h *BusinessMetricHandler) Get(c *gin.Context) {
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
	response.OK(c, dto.FromBusinessMetric(item))
}

// Update handles PUT /business-metrics/{id}.
func (h *BusinessMetricHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.BusinessMetricRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	updated, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromBusinessMetric(updated))
}

// Delete handles DELETE /business-metrics/{id}.
func (h *BusinessMetricHandler) Delete(c *gin.Context) {
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
