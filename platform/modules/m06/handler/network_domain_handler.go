package handler

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// NetworkDomainHandler exposes the M06 v3 network-domain administration API.
type NetworkDomainHandler struct {
	svc *service.NetworkDomainService
}

// NewNetworkDomainHandler constructs a network-domain handler.
func NewNetworkDomainHandler(svc *service.NetworkDomainService) *NetworkDomainHandler {
	return &NetworkDomainHandler{svc: svc}
}

// List handles GET /network-domains.
func (h *NetworkDomainHandler) List(c *gin.Context) {
	status, err := domain.ParseDomainStatus(c.Query("status"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	page, pageSize := parsePagination(c)
	items, total, err := h.svc.List(c.Request.Context(), repository.ListNetworkDomainsFilter{
		Status:    string(status),
		Keyword:   strings.TrimSpace(c.Query("keyword")),
		CloudCode: strings.TrimSpace(c.Query("cloud_code")),
		ZoneType:  strings.TrimSpace(c.Query("zone_type")),
		TenantID:  strings.TrimSpace(c.Query("tenant_id")),
		Page:      page,
		PageSize:  pageSize,
	})
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	list := make([]dto.NetworkDomainResponse, 0, len(items))
	for _, item := range items {
		list = append(list, dto.FromNetworkDomain(item))
	}
	response.OK(c, dto.ListNetworkDomainsResponse{List: list, Total: total, Page: page, PageSize: pageSize})
}

// Get handles GET /network-domains/:id.
func (h *NetworkDomainHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromNetworkDomain(item))
}

// Impact handles GET /network-domains/:id/impact.
func (h *NetworkDomainHandler) Impact(c *gin.Context) {
	impact, err := h.svc.Impact(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromImpact(impact))
}

// Create handles POST /network-domains.
func (h *NetworkDomainHandler) Create(c *gin.Context) {
	var req dto.CreateNetworkDomainRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	input, err := req.ToDomain()
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	item, err := h.svc.Create(c.Request.Context(), input)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromNetworkDomain(item))
}

// Update handles PUT /network-domains/:id.
func (h *NetworkDomainHandler) Update(c *gin.Context) {
	var req dto.UpdateNetworkDomainRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	input := req.ToDomain()
	if !input.HasChanges() {
		response.BadRequest(c, fmt.Errorf("at least one of name/description/zone_type/authorized_tenant_ids is required"))
		return
	}
	item, err := h.svc.Update(c.Request.Context(), c.Param("id"), input)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromNetworkDomain(item))
}

// UpdateStatus handles PATCH /network-domains/:id/status.
func (h *NetworkDomainHandler) UpdateStatus(c *gin.Context) {
	var req dto.UpdateNetworkDomainStatusRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	impact, err := h.svc.UpdateStatus(c.Request.Context(), c.Param("id"), req.Status)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	out := dto.UpdateNetworkDomainStatusResponse{
		ID:     c.Param("id"),
		Status: strings.TrimSpace(req.Status),
	}
	if impact != nil {
		converted := dto.FromImpact(impact)
		out.Impact = &converted
	}
	response.OK(c, out)
}

// Delete handles DELETE /network-domains/:id.
func (h *NetworkDomainHandler) Delete(c *gin.Context) {
	impact, err := h.svc.Delete(c.Request.Context(), c.Param("id"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	converted := dto.FromImpact(impact)
	response.OK(c, dto.DeleteNetworkDomainResponse{
		ID:            c.Param("id"),
		Deleted:       true,
		Impact:        converted,
		CascadeImpact: converted,
	})
}

// decodeStrictJSON rejects unknown fields so immutable contract fields cannot
// be silently ignored (D20).
func decodeStrictJSON(c *gin.Context, target any) error {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}
