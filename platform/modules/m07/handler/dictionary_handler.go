package handler

import (
	"errors"
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dictionary"
	"github.com/metriccenter/metriccenter/platform/modules/m07/dto"
)

// DictionaryHandler exposes the v3 dictionary API.
type DictionaryHandler struct {
	svc *dictionary.Service
}

// NewDictionaryHandler constructs a dictionary handler.
func NewDictionaryHandler(svc *dictionary.Service) *DictionaryHandler {
	return &DictionaryHandler{svc: svc}
}

func (h *DictionaryHandler) ListBusinessDomains(c *gin.Context) {
	items, err := h.svc.ListBusinessDomains(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromBusinessDomains(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

type createBusinessDomainRequest struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

func (h *DictionaryHandler) CreateBusinessDomain(c *gin.Context) {
	var req createBusinessDomainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.CreateBusinessDomain(c.Request.Context(), req.Code, req.Name, req.Description)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromBusinessDomain(item))
}

type updateBusinessDomainRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Enabled     *bool   `json:"enabled"`
}

func (h *DictionaryHandler) UpdateBusinessDomain(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" {
		response.BadRequest(c, fmt.Errorf("code is required"))
		return
	}
	var req updateBusinessDomainRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.UpdateBusinessDomain(c.Request.Context(), code, req.Name, req.Description, req.Enabled)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromBusinessDomain(item))
}

func (h *DictionaryHandler) ListApplications(c *gin.Context) {
	items, err := h.svc.ListApplications(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromApplications(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

type createApplicationRequest struct {
	AppCode     string `json:"app_code"`
	AppName     string `json:"app_name"`
	Description string `json:"description"`
}

func (h *DictionaryHandler) CreateApplication(c *gin.Context) {
	var req createApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.CreateApplication(c.Request.Context(), req.AppCode, req.AppName, req.Description)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromApplication(item))
}

type updateApplicationRequest struct {
	AppName     *string `json:"app_name"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
}

func (h *DictionaryHandler) UpdateApplication(c *gin.Context) {
	appCode := strings.TrimSpace(c.Param("app_code"))
	if appCode == "" {
		response.BadRequest(c, fmt.Errorf("app_code is required"))
		return
	}
	var req updateApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.UpdateApplication(c.Request.Context(), appCode, req.AppName, req.Description, req.Status)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromApplication(item))
}

func (h *DictionaryHandler) ListPlatforms(c *gin.Context) {
	items, err := h.svc.ListPlatforms(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromPlatforms(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

type createPlatformRequest struct {
	PlatformCode string `json:"platform_code"`
	PlatformName string `json:"platform_name"`
	Description  string `json:"description"`
}

func (h *DictionaryHandler) CreatePlatform(c *gin.Context) {
	var req createPlatformRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.CreatePlatform(c.Request.Context(), req.PlatformCode, req.PlatformName, req.Description)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromPlatform(item))
}

type updatePlatformRequest struct {
	PlatformName *string `json:"platform_name"`
	Description  *string `json:"description"`
	Enabled      *bool   `json:"enabled"`
}

func (h *DictionaryHandler) UpdatePlatform(c *gin.Context) {
	platformCode := strings.TrimSpace(c.Param("platform_code"))
	if platformCode == "" {
		response.BadRequest(c, fmt.Errorf("platform_code is required"))
		return
	}
	var req updatePlatformRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.UpdatePlatform(c.Request.Context(), platformCode, req.PlatformName, req.Description, req.Enabled)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromPlatform(item))
}

func (h *DictionaryHandler) ListClouds(c *gin.Context) {
	items, err := h.svc.ListClouds(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromClouds(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

func (h *DictionaryHandler) ListZoneTypes(c *gin.Context) {
	items, err := h.svc.ListZoneTypes(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromZoneTypes(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

func (h *DictionaryHandler) ListOSOptions(c *gin.Context) {
	items, err := h.svc.ListOSOptions(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromOSOptions(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

func (h *DictionaryHandler) ListAppPlatformRels(c *gin.Context) {
	items, err := h.svc.ListAppPlatformRels(
		c.Request.Context(),
		strings.TrimSpace(c.Query("app_code")),
		strings.TrimSpace(c.Query("platform_code")),
	)
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromAppPlatformRels(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

type createAppPlatformRelRequest struct {
	AppCode      string `json:"app_code"`
	PlatformCode string `json:"platform_code"`
	IsPrimary    bool   `json:"is_primary"`
}

func (h *DictionaryHandler) CreateAppPlatformRel(c *gin.Context) {
	var req createAppPlatformRelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	req.AppCode = strings.TrimSpace(req.AppCode)
	req.PlatformCode = strings.TrimSpace(req.PlatformCode)
	if req.AppCode == "" || req.PlatformCode == "" {
		response.BadRequest(c, fmt.Errorf("app_code and platform_code are required"))
		return
	}
	rel, err := h.svc.CreateAppPlatformRel(c.Request.Context(), req.AppCode, req.PlatformCode, req.IsPrimary)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromAppPlatformRel(rel))
}

type updateAppPlatformRelRequest struct {
	IsPrimary *bool `json:"is_primary"`
}

func (h *DictionaryHandler) UpdateAppPlatformRel(c *gin.Context) {
	relID := strings.TrimSpace(c.Param("rel_id"))
	if relID == "" {
		response.BadRequest(c, fmt.Errorf("rel_id is required"))
		return
	}
	var req updateAppPlatformRelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	if req.IsPrimary == nil {
		response.BadRequest(c, fmt.Errorf("is_primary is required"))
		return
	}
	rel, err := h.svc.SetPrimaryAppPlatformRel(c.Request.Context(), relID, *req.IsPrimary)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromAppPlatformRel(rel))
}

func (h *DictionaryHandler) DeleteAppPlatformRel(c *gin.Context) {
	relID := strings.TrimSpace(c.Param("rel_id"))
	if relID == "" {
		response.BadRequest(c, fmt.Errorf("rel_id is required"))
		return
	}
	if err := h.svc.DeleteAppPlatformRel(c.Request.Context(), relID); err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, gin.H{"rel_id": relID})
}

func respondDictionaryError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, dictionary.ErrAppPlatformRelExists):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrPrimaryPlatformExists):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrDictionaryExists):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrAppPlatformRelNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, dictionary.ErrDictionaryNotFound):
		response.NotFound(c, err.Error())
	default:
		respondError(c, err)
	}
}
