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

// MappingHandler exposes the default collection mapping API (FR-01/FR-03).
type MappingHandler struct {
	svc *service.MappingService
}

// NewMappingHandler constructs the handler.
func NewMappingHandler(svc *service.MappingService) *MappingHandler {
	return &MappingHandler{svc: svc}
}

// List handles GET /ci-exporter-mappings.
func (h *MappingHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.MappingFilter{
		MonitorType: strings.TrimSpace(c.Query("monitor_type")),
		IsDefault:   boolQuery(c, "is_default"),
		Keyword:     strings.TrimSpace(c.Query("keyword")),
		Page:        page,
		PageSize:    pageSize,
	}
	views, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.MappingResponse, 0, len(views))
	for _, view := range views {
		list = append(list, dto.FromMapping(view.Mapping, view.ExporterTemplateName, view.LabelTemplateName))
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Create handles POST /ci-exporter-mappings.
func (h *MappingHandler) Create(c *gin.Context) {
	var req dto.MappingRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMapping(view.Mapping, view.ExporterTemplateName, view.LabelTemplateName))
}

// Update handles PUT /ci-exporter-mappings/{id}.
func (h *MappingHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.MappingRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMapping(view.Mapping, view.ExporterTemplateName, view.LabelTemplateName))
}

// Delete handles DELETE /ci-exporter-mappings/{id}.
func (h *MappingHandler) Delete(c *gin.Context) {
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

// SetLabelTemplate handles PUT /ci-exporter-mappings/{id}/label-template.
func (h *MappingHandler) SetLabelTemplate(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.SetLabelTemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	view, err := h.svc.SetLabelTemplate(c.Request.Context(), id, req.LabelTemplateID)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMapping(view.Mapping, view.ExporterTemplateName, view.LabelTemplateName))
}
