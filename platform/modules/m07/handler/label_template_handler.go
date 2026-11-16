package handler

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
)

// LabelTemplateHandler exposes the v3 label template API.
type LabelTemplateHandler struct {
	svc *service.LabelTemplateService
}

// NewLabelTemplateHandler constructs the handler.
func NewLabelTemplateHandler(svc *service.LabelTemplateService) *LabelTemplateHandler {
	return &LabelTemplateHandler{svc: svc}
}

// List handles GET /label-templates.
func (h *LabelTemplateHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	filter := repository.LabelTemplateFilter{
		ResourceCategory: domain.Category(strings.TrimSpace(c.Query("resource_category"))),
		IsDefault:        boolQuery(c, "is_default"),
		Keyword:          strings.TrimSpace(c.Query("keyword")),
		Page:             page,
		PageSize:         pageSize,
	}
	items, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{
		"list":      dto.FromLabelTemplates(items),
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// Create handles POST /label-templates.
func (h *LabelTemplateHandler) Create(c *gin.Context) {
	var req dto.LabelTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	created, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromLabelTemplate(created))
}

// Get handles GET /label-templates/{id}.
func (h *LabelTemplateHandler) Get(c *gin.Context) {
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
	response.OK(c, dto.FromLabelTemplate(item))
}

// Update handles PUT /label-templates/{id}.
func (h *LabelTemplateHandler) Update(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.LabelTemplateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	updated, err := h.svc.Update(c.Request.Context(), id, req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromLabelTemplate(updated))
}

// Delete handles DELETE /label-templates/{id}.
func (h *LabelTemplateHandler) Delete(c *gin.Context) {
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

func boolQuery(c *gin.Context, key string) *bool {
	raw := c.Query(key)
	if raw == "" {
		return nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return nil
	}
	return &value
}
