package handler

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
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
	// PlatformCodes 是应用必须归属的平台集合（D42：至少一个，首个即主平台）。
	PlatformCodes []string `json:"platform_codes"`
}

func (h *DictionaryHandler) CreateApplication(c *gin.Context) {
	var req createApplicationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	item, err := h.svc.CreateApplication(c.Request.Context(), req.AppCode, req.AppName, req.Description, req.PlatformCodes)
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

// --- dictionary lifecycle (M07 SRS v2.0 §5.7) -------------------------------

func (h *DictionaryHandler) RevokeBusinessDomain(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	if code == "" {
		response.BadRequest(c, fmt.Errorf("code is required"))
		return
	}
	item, err := h.svc.RevokeBusinessDomain(c.Request.Context(), code, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromBusinessDomain(item))
}

func (h *DictionaryHandler) RevokeApplication(c *gin.Context) {
	appCode := strings.TrimSpace(c.Param("app_code"))
	if appCode == "" {
		response.BadRequest(c, fmt.Errorf("app_code is required"))
		return
	}
	item, err := h.svc.RevokeApplication(c.Request.Context(), appCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromApplication(item))
}

func (h *DictionaryHandler) RevokePlatform(c *gin.Context) {
	platformCode := strings.TrimSpace(c.Param("platform_code"))
	if platformCode == "" {
		response.BadRequest(c, fmt.Errorf("platform_code is required"))
		return
	}
	item, err := h.svc.RevokePlatform(c.Request.Context(), platformCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromPlatform(item))
}

type mergeDictionaryRequest struct {
	TargetCode string `json:"target_code"`
}

func (h *DictionaryHandler) MergeBusinessDomain(c *gin.Context) {
	code := strings.TrimSpace(c.Param("code"))
	var req mergeDictionaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	moved, err := h.svc.MergeBusinessDomain(c.Request.Context(), code, req.TargetCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, gin.H{
		"source": code, "target": strings.TrimSpace(req.TargetCode), "moved_references": moved,
	})
}

func (h *DictionaryHandler) MergeApplication(c *gin.Context) {
	appCode := strings.TrimSpace(c.Param("app_code"))
	var req mergeDictionaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	moved, err := h.svc.MergeApplication(c.Request.Context(), appCode, req.TargetCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, gin.H{
		"source": appCode, "target": strings.TrimSpace(req.TargetCode), "moved_references": moved,
	})
}

func (h *DictionaryHandler) MergePlatform(c *gin.Context) {
	platformCode := strings.TrimSpace(c.Param("platform_code"))
	var req mergeDictionaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	moved, err := h.svc.MergePlatform(c.Request.Context(), platformCode, req.TargetCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, gin.H{
		"source": platformCode, "target": strings.TrimSpace(req.TargetCode), "moved_references": moved,
	})
}

func (h *DictionaryHandler) RevokeCloud(c *gin.Context) {
	cloudCode := strings.TrimSpace(c.Param("cloud_code"))
	if cloudCode == "" {
		response.BadRequest(c, fmt.Errorf("cloud_code is required"))
		return
	}
	item, err := h.svc.RevokeCloud(c.Request.Context(), cloudCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, dto.FromCloud(item))
}

func (h *DictionaryHandler) MergeCloud(c *gin.Context) {
	cloudCode := strings.TrimSpace(c.Param("cloud_code"))
	var req mergeDictionaryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request body: %w", err))
		return
	}
	moved, err := h.svc.MergeCloud(c.Request.Context(), cloudCode, req.TargetCode, dictionaryOperator(c))
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	response.OK(c, gin.H{
		"source": cloudCode, "target": strings.TrimSpace(req.TargetCode), "moved_references": moved,
	})
}

func (h *DictionaryHandler) ListDictionaryAuditLogs(c *gin.Context) {
	limit := 50
	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			limit = parsed
		}
	}
	items, err := h.svc.ListDictionaryAuditLogs(
		c.Request.Context(),
		strings.TrimSpace(c.Query("dictionary_type")),
		strings.TrimSpace(c.Query("code")),
		limit,
	)
	if err != nil {
		respondDictionaryError(c, err)
		return
	}
	list := dto.FromDictionaryAuditLogs(items)
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// dictionaryOperator resolves the audit actor. Unauthenticated dev/standalone
// runs fall back to platform_admin, matching the import pipeline.
func dictionaryOperator(c *gin.Context) string {
	if name := auth.CurrentUsername(c); name != "" {
		return name
	}
	return "platform_admin"
}

func respondDictionaryError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, dictionary.ErrAppPlatformRelExists):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrPrimaryPlatformExists):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrAppRequiresPlatform):
		// D42 I1：删除后应用将无平台归属，属状态冲突。
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrPrimaryPlatformTransferRequired):
		// D42 I3：主平台须显式转移，属状态冲突。
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrDictionaryExists):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrDictionaryReferenced):
		// M07 SRS v2.0：有引用只能停用或合并，撤销属状态冲突。
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrDictionaryTerminal):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrDictionaryMergeInvalid):
		response.Conflict(c, err)
	case errors.Is(err, dictionary.ErrDictionaryMergeSelf):
		response.BadRequest(c, err)
	case errors.Is(err, dictionary.ErrAppPlatformRelNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, dictionary.ErrDictionaryNotFound):
		response.NotFound(c, err.Error())
	default:
		respondError(c, err)
	}
}
