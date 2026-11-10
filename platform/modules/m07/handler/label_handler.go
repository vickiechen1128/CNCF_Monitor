package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
)

// LabelHandler exposes the v3 resource label API.
type LabelHandler struct {
	svc *service.LabelService
}

// NewLabelHandler constructs a label handler.
func NewLabelHandler(svc *service.LabelService) *LabelHandler {
	return &LabelHandler{svc: svc}
}

func (h *LabelHandler) List(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	labels, err := h.svc.List(c.Request.Context(), resourceID)
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromLabels(labels)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

func (h *LabelHandler) Create(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	var req dto.CreateLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	label, err := h.svc.Add(c.Request.Context(), resourceID, req.Key, req.Value)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromLabel(label))
}

func (h *LabelHandler) Update(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	labelID := strings.TrimSpace(c.Param("label_id"))
	if resourceID == "" || labelID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id and label_id are required"))
		return
	}
	var req dto.UpdateLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	label, err := h.svc.Update(c.Request.Context(), resourceID, labelID, req.Value)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromLabel(label))
}

func (h *LabelHandler) Delete(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	labelID := strings.TrimSpace(c.Param("label_id"))
	if resourceID == "" || labelID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id and label_id are required"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), resourceID, labelID); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"label_id": labelID})
}
