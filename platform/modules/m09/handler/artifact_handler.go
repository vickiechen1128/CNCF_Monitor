package handler

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// ArtifactHandler exposes the unified read-only config-artifact history over
// domain scrape configs, center rules and M08 alertmanager history.
type ArtifactHandler struct {
	onboard   *service.OnboardingService
	artifacts *service.ArtifactService
}

// NewArtifactHandler constructs the handler.
func NewArtifactHandler(onboard *service.OnboardingService, artifacts *service.ArtifactService) *ArtifactHandler {
	return &ArtifactHandler{onboard: onboard, artifacts: artifacts}
}

// List handles GET /config-artifacts.
func (h *ArtifactHandler) List(c *gin.Context) {
	artifactType := strings.TrimSpace(c.Query("artifact_type"))
	switch repository.ArtifactType(artifactType) {
	case "":
	case repository.ArtifactTypeDomain, repository.ArtifactTypeCenter, repository.ArtifactTypeAlertmanager:
	default:
		response.BadRequest(c, fmt.Errorf(
			"artifact_type: invalid value %q: must be domain, center or alertmanager", artifactType))
		return
	}
	status := strings.TrimSpace(c.Query("validation_status"))
	switch status {
	case "", "passed", "failed":
	default:
		response.BadRequest(c, fmt.Errorf(
			"validation_status: invalid value %q: must be passed or failed", status))
		return
	}
	if domainID := strings.TrimSpace(c.Query("network_domain_id")); domainID != "" {
		if artifactType != "" && artifactType != string(repository.ArtifactTypeDomain) {
			response.BadRequest(c, fmt.Errorf("network_domain_id only applies to artifact_type=domain"))
			return
		}
		artifactType = string(repository.ArtifactTypeDomain)
	}
	limit, err := parseArtifactLimit(c)
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	actor := actorOf(c)
	allowed, err := h.onboard.AllowedDomainIDs(c.Request.Context(), actor)
	if err != nil {
		respondError(c, err)
		return
	}
	items, err := h.artifacts.List(c.Request.Context(), repository.ArtifactFilter{
		Type:             repository.ArtifactType(artifactType),
		ScopeKey:         strings.TrimSpace(c.Query("network_domain_id")),
		ValidationStatus: status,
		RestrictDomains:  !actor.IsPlatformAdmin,
		AllowedDomains:   allowed,
		Limit:            limit,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ConfigArtifactResponse, 0, len(items))
	for i := range items {
		list = append(list, dto.FromConfigArtifact(&items[i]))
	}
	response.OK(c, dto.ListConfigArtifactsResponse{List: list, Total: int64(len(list))})
}

// Get handles GET /config-artifacts/:id.
func (h *ArtifactHandler) Get(c *gin.Context) {
	item, ok := h.artifactForRequest(c)
	if !ok {
		return
	}
	response.OK(c, dto.FromConfigArtifact(item))
}

// Preview handles GET /config-artifacts/:id/content (admin only).
func (h *ArtifactHandler) Preview(c *gin.Context) {
	id, ok := parseArtifactID(c)
	if !ok {
		return
	}
	view, err := h.artifacts.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	if view == nil {
		response.NotFound(c, fmt.Sprintf("config artifact %d not found", id))
		return
	}
	if !h.authorizeDomain(c, view) {
		return
	}
	preview, err := h.artifacts.Preview(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromConfigArtifactPreview(preview))
}

// Export handles GET /config-artifacts/:id/export (admin only). `raw=1`
// returns the original stored payload instead of the directly usable file.
func (h *ArtifactHandler) Export(c *gin.Context) {
	item, ok := h.artifactForRequest(c)
	if !ok {
		return
	}
	var (
		export *service.ArtifactExport
		err    error
	)
	if c.Query("raw") == "1" {
		export, err = h.artifacts.ExportRaw(c.Request.Context(), item.ID)
	} else {
		export, err = h.artifacts.Export(c.Request.Context(), item.ID)
	}
	if err != nil {
		respondError(c, err)
		return
	}
	if export == nil {
		response.NotFound(c, fmt.Sprintf("config artifact %d not found", item.ID))
		return
	}
	writeArtifactDownload(c, export)
}

// RecoveryBundle handles GET /config-artifacts/recovery-bundle (admin only).
func (h *ArtifactHandler) RecoveryBundle(c *gin.Context) {
	export, err := h.artifacts.RecoveryBundle(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	writeArtifactDownload(c, export)
}

func (h *ArtifactHandler) artifactForRequest(c *gin.Context) (*service.ArtifactView, bool) {
	id, ok := parseArtifactID(c)
	if !ok {
		return nil, false
	}
	view, err := h.artifacts.Get(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return nil, false
	}
	if view == nil {
		response.NotFound(c, fmt.Sprintf("config artifact %d not found", id))
		return nil, false
	}
	if !h.authorizeDomain(c, view) {
		return nil, false
	}
	return view, true
}

// authorizeDomain keeps domain-scoped artifacts behind the same tenant
// authorization as the per-domain snapshot endpoints. Platform scopes are
// visible to every authenticated caller; content stays admin-only by route.
func (h *ArtifactHandler) authorizeDomain(c *gin.Context, view *service.ArtifactView) bool {
	if view.ArtifactType != repository.ArtifactTypeDomain {
		return true
	}
	if _, err := h.onboard.Get(c.Request.Context(), actorOf(c), view.NetworkDomainID); err != nil {
		respondError(c, err)
		return false
	}
	return true
}

func parseArtifactID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, fmt.Errorf("id: must be a positive integer"))
		return 0, false
	}
	return id, true
}

func parseArtifactLimit(c *gin.Context) (int, error) {
	raw := strings.TrimSpace(c.Query("limit"))
	if raw == "" {
		return 100, nil
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit <= 0 {
		return 0, fmt.Errorf("limit: must be a positive integer")
	}
	if limit > 500 {
		return 0, fmt.Errorf("limit: must be <= 500")
	}
	return limit, nil
}

func writeArtifactDownload(c *gin.Context, export *service.ArtifactExport) {
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", export.FileName))
	c.Data(http.StatusOK, export.ContentType, export.Data)
}
