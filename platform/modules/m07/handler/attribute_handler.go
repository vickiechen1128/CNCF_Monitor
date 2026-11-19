package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
)

// AttributeHandler exposes the generic capability attribute API
// (SRS Module_07 v2.1 §5.8 FR-31).
type AttributeHandler struct {
	svc *service.AttributeService
}

// NewAttributeHandler constructs the handler.
func NewAttributeHandler(svc *service.AttributeService) *AttributeHandler {
	return &AttributeHandler{svc: svc}
}

// ListDefinitions handles GET /attribute-definitions?resource_category=…
func (h *AttributeHandler) ListDefinitions(c *gin.Context) {
	category := domain.Category(strings.TrimSpace(c.Query("resource_category")))
	defs, err := h.svc.ListDefinitions(c.Request.Context(), category)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.AttributeDefinitionResponse, 0, len(defs))
	for _, def := range defs {
		list = append(list, dto.FromAttributeDefinition(def))
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// CreateDefinition handles POST /attribute-definitions.
func (h *AttributeHandler) CreateDefinition(c *gin.Context) {
	var req dto.AttributeDefinitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	def, err := h.svc.CreateDefinition(c.Request.Context(), req.ToDomain())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromAttributeDefinition(def))
}

// UpdateDefinition handles PUT /attribute-definitions/:id.
func (h *AttributeHandler) UpdateDefinition(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		response.BadRequest(c, fmt.Errorf("id is required"))
		return
	}
	var req dto.AttributeDefinitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	def, err := h.svc.UpdateDefinition(c.Request.Context(), id, req.ToDomain(), req.Enabled)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromAttributeDefinition(def))
}

// DeleteDefinition handles DELETE /attribute-definitions/:id.
func (h *AttributeHandler) DeleteDefinition(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if err := h.svc.DeleteDefinition(c.Request.Context(), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"id": id, "deleted": true})
}

// ListResourceAttributes handles GET /resources/:resource_id/attributes.
func (h *AttributeHandler) ListResourceAttributes(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	attrs, err := h.svc.ListResourceAttributes(c.Request.Context(), resourceID)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ResourceAttributeResponse, 0, len(attrs))
	for _, attr := range attrs {
		list = append(list, dto.FromResourceAttribute(attr))
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// ReplaceResourceAttributes handles PUT /resources/:resource_id/attributes.
func (h *AttributeHandler) ReplaceResourceAttributes(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	var req dto.ReplaceAttributesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	values := make([]service.AttributeValue, 0, len(req.Attributes))
	for _, item := range req.Attributes {
		values = append(values, service.AttributeValue{Key: item.Key, Value: item.Value})
	}
	attrs, err := h.svc.ReplaceResourceAttributes(c.Request.Context(), resourceID, values)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ResourceAttributeResponse, 0, len(attrs))
	for _, attr := range attrs {
		list = append(list, dto.FromResourceAttribute(attr))
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}
