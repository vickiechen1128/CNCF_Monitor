package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// ProbeModuleHandler exposes blackbox probe module management (FR-11).
type ProbeModuleHandler struct {
	svc *service.ProbeModuleService
}

// NewProbeModuleHandler constructs the handler.
func NewProbeModuleHandler(svc *service.ProbeModuleService) *ProbeModuleHandler {
	return &ProbeModuleHandler{svc: svc}
}

// List handles GET /blackbox-modules.
func (h *ProbeModuleHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.ProbeModuleFilter{
		Enabled:  boolQuery(c, "enabled"),
		Keyword:  strings.TrimSpace(c.Query("keyword")),
		Page:     page,
		PageSize: pageSize,
	}
	items, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ProbeModuleResponse, 0, len(items))
	for _, item := range items {
		count, err := h.svc.ReferenceCount(c.Request.Context(), item.Name)
		if err != nil {
			respondError(c, err)
			return
		}
		list = append(list, dto.FromProbeModule(item, count))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Get handles GET /blackbox-modules/{id}.
func (h *ProbeModuleHandler) Get(c *gin.Context) {
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
	count, err := h.svc.ReferenceCount(c.Request.Context(), item.Name)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromProbeModule(item, count))
}
