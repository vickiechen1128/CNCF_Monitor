package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m01/service"
)

// MonitorTypeHandler exposes the configurable monitor type registry
// (SRS Module_01 v1.3 §5.6, FR-21 ~ FR-24).
type MonitorTypeHandler struct {
	svc *service.MonitorTypeService
}

// NewMonitorTypeHandler constructs the handler.
func NewMonitorTypeHandler(svc *service.MonitorTypeService) *MonitorTypeHandler {
	return &MonitorTypeHandler{svc: svc}
}

// List handles GET /monitor-types?resource_category=…
func (h *MonitorTypeHandler) List(c *gin.Context) {
	category := domain.ResourceCategory(strings.TrimSpace(c.Query("resource_category")))
	entries, err := h.svc.ListByCategory(c.Request.Context(), category)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.MonitorTypeResponse, 0, len(entries))
	for _, entry := range entries {
		list = append(list, dto.FromMonitorTypeEntry(entry))
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// Get handles GET /monitor-types/:code.
func (h *MonitorTypeHandler) Get(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	entry, err := h.svc.Get(c.Request.Context(), code)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMonitorTypeEntry(entry))
}

// Create handles POST /monitor-types.
func (h *MonitorTypeHandler) Create(c *gin.Context) {
	var req dto.MonitorTypeRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	entry, err := h.svc.Create(c.Request.Context(), req.ToDomain(req.Code))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMonitorTypeEntry(entry))
}

// Update handles PUT /monitor-types/:code.
func (h *MonitorTypeHandler) Update(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" {
		response.BadRequest(c, fmt.Errorf("code is required"))
		return
	}
	var req dto.MonitorTypeRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	entry, err := h.svc.Update(c.Request.Context(), code, req.ToDomain(code))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMonitorTypeEntry(entry))
}

// Delete handles DELETE /monitor-types/:code.
func (h *MonitorTypeHandler) Delete(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if err := h.svc.Delete(c.Request.Context(), code); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"code": code, "deleted": true})
}

// Impact handles GET /monitor-types/:code/impact (FR-24).
func (h *MonitorTypeHandler) Impact(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	impact, err := h.svc.Impact(c.Request.Context(), code)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, impact)
}

// ScopeFields handles GET /monitor-types/scope-fields: the closed whitelist of
// fields a derivation rule may reference, so the UI never hard-codes them.
func (h *MonitorTypeHandler) ScopeFields(c *gin.Context) {
	specs := h.svc.ScopeFields()
	list := make([]dto.ScopeFieldResponse, 0, len(specs))
	for _, spec := range specs {
		list = append(list, dto.FromScopeFieldSpec(spec))
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}
