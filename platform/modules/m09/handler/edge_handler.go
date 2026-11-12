package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// EdgeHandler implements the machine-to-machine edge protocol.
type EdgeHandler struct {
	svc  *service.EdgeService
	sync *service.ConfigSyncService
}

// NewEdgeHandler constructs the edge protocol handler.
func NewEdgeHandler(svc *service.EdgeService, sync *service.ConfigSyncService) *EdgeHandler {
	return &EdgeHandler{svc: svc, sync: sync}
}

// Heartbeat handles POST /api/v3/edge/heartbeat.
func (h *EdgeHandler) Heartbeat(c *gin.Context) {
	domainID := NetworkDomainFromContext(c)
	if domainID == "" {
		respondError(c, apierror.New(apierror.Unauthorized, "edge token is required"))
		return
	}
	var req domain.HeartbeatRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	result, err := h.svc.HandleHeartbeat(c.Request.Context(), domainID, req)
	if err != nil {
		respondError(c, err)
		return
	}
	// The protocol returns a relative path; make it absolute for the agent.
	if result != nil && result.ConfigDownloadURL != "" {
		if base := centerEndpoint(c); base != "" {
			result.ConfigDownloadURL = base + result.ConfigDownloadURL
		}
	}
	response.OK(c, result)
}

// Config handles GET /api/v3/edge/config: returns the current validated config
// package for the token's domain, with ETag-based 304 support (contract §6.2).
func (h *EdgeHandler) Config(c *gin.Context) {
	domainID := NetworkDomainFromContext(c)
	if domainID == "" {
		respondError(c, apierror.New(apierror.Unauthorized, "edge token is required"))
		return
	}
	if h.sync == nil {
		response.NotFound(c, "no published config yet; wait for the center to generate one")
		return
	}
	checksum, content, err := h.sync.CurrentConfigZip(c.Request.Context(), domainID)
	if err != nil {
		respondError(c, err)
		return
	}
	if content == nil {
		response.NotFound(c, "no published config yet; check the center config generation status and retry")
		return
	}
	etag := `"` + checksum + `"`
	if match := c.GetHeader("If-None-Match"); match != "" && (match == etag || strings.Contains(match, checksum)) {
		c.Status(http.StatusNotModified)
		return
	}
	c.Header("ETag", etag)
	c.Data(http.StatusOK, "application/zip", content)
}
