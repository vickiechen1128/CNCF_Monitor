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

func (h *DictionaryHandler) ListApplications(c *gin.Context) {
	items, err := h.svc.ListApplications(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := dto.FromApplications(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
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
	case errors.Is(err, dictionary.ErrAppPlatformRelNotFound):
		response.NotFound(c, err.Error())
	default:
		respondError(c, err)
	}
}
