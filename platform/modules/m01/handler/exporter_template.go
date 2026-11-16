package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// ExporterTemplateHandler exposes the exporter pool API (FR-02).
type ExporterTemplateHandler struct {
	svc *service.ExporterTemplateService
}

// NewExporterTemplateHandler constructs the handler.
func NewExporterTemplateHandler(svc *service.ExporterTemplateService) *ExporterTemplateHandler {
	return &ExporterTemplateHandler{svc: svc}
}

// List handles GET /exporter-templates.
func (h *ExporterTemplateHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.ExporterTemplateFilter{
		Source:    domain.ExporterSource(strings.TrimSpace(c.Query("source"))),
		OS:        strings.TrimSpace(c.Query("os")),
		Arch:      strings.TrimSpace(c.Query("arch")),
		IsBuiltin: boolQuery(c, "is_builtin"),
		Keyword:   strings.TrimSpace(c.Query("keyword")),
		Page:      page,
		PageSize:  pageSize,
	}
	items, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{
		"list":      dto.FromExporterTemplates(items),
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// Create handles POST /exporter-templates.
func (h *ExporterTemplateHandler) Create(c *gin.Context) {
	var req dto.ExporterTemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	created, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromExporterTemplate(created))
}

// Get handles GET /exporter-templates/{id}.
func (h *ExporterTemplateHandler) Get(c *gin.Context) {
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
	response.OK(c, dto.FromExporterTemplate(item))
}

// Update handles PUT /exporter-templates/{id}.
func (h *ExporterTemplateHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.ExporterTemplateRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	updated, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromExporterTemplate(updated))
}

// Delete handles DELETE /exporter-templates/{id}.
func (h *ExporterTemplateHandler) Delete(c *gin.Context) {
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
