// Package handler exposes the M06 v3 HTTP API.
package handler

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// TenantHandler exposes tenant administration.
type TenantHandler struct {
	svc *service.TenantService
}

// NewTenantHandler constructs a tenant handler.
func NewTenantHandler(svc *service.TenantService) *TenantHandler {
	return &TenantHandler{svc: svc}
}

// List handles GET /tenants.
func (h *TenantHandler) List(c *gin.Context) {
	status, err := domain.ParseTenantStatus(c.Query("status"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	page, pageSize := parsePagination(c)
	list, total, err := h.svc.List(c.Request.Context(), repository.ListTenantsFilter{
		Status:   string(status),
		Keyword:  strings.TrimSpace(c.Query("keyword")),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	items := make([]dto.TenantResponse, 0, len(list))
	for _, tenant := range list {
		items = append(items, dto.FromDomain(tenant))
	}
	response.OK(c, dto.ListTenantsResponse{List: items, Total: total, Page: page, PageSize: pageSize})
}

// Get handles GET /tenants/:id.
func (h *TenantHandler) Get(c *gin.Context) {
	tenant, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromDomain(tenant))
}

// Update handles PUT /tenants/:id. Unknown and immutable fields are rejected
// by the strict JSON decoder (D20).
func (h *TenantHandler) Update(c *gin.Context) {
	var req dto.UpdateTenantRequest
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if !req.ToDomain().HasChanges() {
		response.BadRequest(c, fmt.Errorf("at least one of name/multi_site_enabled is required"))
		return
	}
	tenant, err := h.svc.Update(c.Request.Context(), c.Param("id"), req.ToDomain())
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromDomain(tenant))
}

// Create handles POST /tenants: reserved for v0.2.
func (h *TenantHandler) Create(c *gin.Context) {
	httpapi.WriteError(c, h.svc.Create(c.Request.Context()))
}

// ChangeStatus handles PATCH /tenants/:id/status: reserved for v0.2.
func (h *TenantHandler) ChangeStatus(c *gin.Context) {
	httpapi.WriteError(c, h.svc.ChangeStatus(c.Request.Context(), c.Param("id")))
}

func parsePagination(c *gin.Context) (int, int) {
	page, _ := strconv.Atoi(c.Query("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(c.Query("page_size"))
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}
