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

// AttributeHandler exposes the custom field and CI model API
// (SRS Module_07 v2.2 §5.8 FR-30~FR-34).
type AttributeHandler struct {
	svc     *service.AttributeService
	ciModel *service.CIModelService
}

// NewAttributeHandler constructs the handler.
func NewAttributeHandler(svc *service.AttributeService, ciModel *service.CIModelService) *AttributeHandler {
	return &AttributeHandler{svc: svc, ciModel: ciModel}
}

// ListDefinitions handles GET /attribute-definitions?resource_category=…&status=…
func (h *AttributeHandler) ListDefinitions(c *gin.Context) {
	category := domain.Category(strings.TrimSpace(c.Query("resource_category")))
	var statuses []domain.AttributeStatus
	if raw := strings.TrimSpace(c.Query("status")); raw != "" {
		status := domain.AttributeStatus(raw)
		if !status.Valid() {
			response.BadRequest(c, fmt.Errorf("status must be active/removed"))
			return
		}
		statuses = append(statuses, status)
	}
	defs, err := h.svc.ListDefinitions(c.Request.Context(), category, statuses...)
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

// ListModels handles GET /ci-models.
func (h *AttributeHandler) ListModels(c *gin.Context) {
	models, err := h.ciModel.List(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.CIModelResponse, 0, len(models))
	for _, model := range models {
		list = append(list, dto.FromCIModel(model.Category, model.CategoryLabel, model.Builtin, model.Custom))
	}
	response.OK(c, dto.CIModelListResponse{List: list})
}

// GetModel handles GET /ci-models/:category.
func (h *AttributeHandler) GetModel(c *gin.Context) {
	category := domain.Category(strings.TrimSpace(c.Param("category")))
	model, err := h.ciModel.Get(c.Request.Context(), category)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromCIModel(model.Category, model.CategoryLabel, model.Builtin, model.Custom))
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
	def, err := h.svc.UpdateDefinition(c.Request.Context(), id, req.ToDomain(), nil)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromAttributeDefinition(def))
}

// RemoveDefinition handles DELETE /attribute-definitions/:id.
//
// The system decides the outcome (FR-34): an unused field is deleted; a field
// still carrying values is removed from the model and keeps its values.
func (h *AttributeHandler) RemoveDefinition(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	result, err := h.svc.RemoveDefinition(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.RemoveDefinitionResponse{ID: id, Mode: result.Mode, UsageCount: result.UsageCount})
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
