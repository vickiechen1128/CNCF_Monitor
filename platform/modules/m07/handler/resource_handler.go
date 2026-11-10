package handler

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m07/service"
)

// ResourceHandler exposes the v3 resource HTTP API.
type ResourceHandler struct {
	svc  *service.ResourceService
	refs references.Reader
}

// NewResourceHandler constructs a resource handler.
func NewResourceHandler(svc *service.ResourceService, refs references.Reader) *ResourceHandler {
	return &ResourceHandler{svc: svc, refs: refs}
}

// List handles GET /resources.
func (h *ResourceHandler) List(c *gin.Context) {
	category, err := domain.ParseCategory(c.Query("resource_category"))
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	page, pageSize := parsePagination(c)
	filter := repository.ListFilter{
		Category:        category,
		NetworkDomainID: strings.TrimSpace(c.Query("network_domain_id")),
		BizCode:         strings.TrimSpace(c.Query("biz_code")),
		AppCode:         strings.TrimSpace(c.Query("app_code")),
		PlatformCode:    strings.TrimSpace(c.Query("platform_code")),
		Status:          domain.Status(strings.TrimSpace(c.Query("status"))),
		Keyword:         strings.TrimSpace(c.Query("keyword")),
		Page:            page,
		PageSize:        pageSize,
	}
	list, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	items := make([]dto.ResourceResponse, 0, len(list))
	for _, resource := range list {
		items = append(items, dto.FromDomain(resource))
	}
	response.OK(c, dto.ListResponse{List: items, Total: total, Page: page, PageSize: pageSize})
}

// Get handles GET /resources/:resource_id.
func (h *ResourceHandler) Get(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	resource, err := h.svc.Get(c.Request.Context(), resourceID)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromDomain(resource))
}

// Create handles POST /resources.
func (h *ResourceHandler) Create(c *gin.Context) {
	var req dto.CreateResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	resource, err := req.ToDomain()
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	created, err := h.svc.Create(c.Request.Context(), resource)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromDomain(created))
}

// Update handles PUT /resources/:resource_id.
func (h *ResourceHandler) Update(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	var req dto.UpdateResourceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	resource, err := req.ToDomain()
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	updated, err := h.svc.Update(c.Request.Context(), resourceID, resource)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromDomain(updated))
}

// Delete handles DELETE /resources/:resource_id.
func (h *ResourceHandler) Delete(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	if err := h.svc.Delete(c.Request.Context(), resourceID); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"resource_id": resourceID})
}

// References handles GET /resources/:resource_id/referenced-by.
func (h *ResourceHandler) References(c *gin.Context) {
	resourceID := strings.TrimSpace(c.Param("resource_id"))
	if resourceID == "" {
		response.BadRequest(c, fmt.Errorf("resource_id is required"))
		return
	}
	if _, err := h.svc.Get(c.Request.Context(), resourceID); err != nil {
		respondError(c, err)
		return
	}
	if h.refs == nil {
		response.OK(c, dto.ReferencesResponse{Jobs: []dto.JobReference{}, Total: 0})
		return
	}
	refs, err := h.refs.ListByResource(c.Request.Context(), resourceID)
	if err != nil {
		respondError(c, err)
		return
	}
	jobs := make([]dto.JobReference, 0, len(refs))
	for _, ref := range refs {
		jobs = append(jobs, dto.JobReference{
			JobName:         ref.JobName,
			NetworkDomainID: ref.NetworkDomainID,
			Enabled:         ref.Enabled,
		})
	}
	response.OK(c, dto.ReferencesResponse{Jobs: jobs, Total: len(jobs)})
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
