package handler

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// SnapshotHandler exposes the read-only config snapshot API (contract §4).
type SnapshotHandler struct {
	onboard *service.OnboardingService
	sync    *service.ConfigSyncService
}

// NewSnapshotHandler constructs the snapshot handler.
func NewSnapshotHandler(onboard *service.OnboardingService, sync *service.ConfigSyncService) *SnapshotHandler {
	return &SnapshotHandler{onboard: onboard, sync: sync}
}

// List handles GET /network-domains/:id/config-snapshots.
func (h *SnapshotHandler) List(c *gin.Context) {
	domainID := c.Param("id")
	if _, err := h.onboard.Get(c.Request.Context(), actorOf(c), domainID); err != nil {
		respondError(c, err)
		return
	}
	items, err := h.sync.ListSnapshots(c.Request.Context(), domainID, 50)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ConfigSnapshotResponse, 0, len(items))
	for i := range items {
		list = append(list, dto.FromConfigSnapshot(&items[i]))
	}
	response.OK(c, dto.ListConfigSnapshotsResponse{List: list, Total: int64(len(list))})
}

// Get handles GET /network-domains/:id/config-snapshots/:snapshot_id.
func (h *SnapshotHandler) Get(c *gin.Context) {
	domainID := c.Param("id")
	if _, err := h.onboard.Get(c.Request.Context(), actorOf(c), domainID); err != nil {
		respondError(c, err)
		return
	}
	snapshotID, ok := parseSnapshotID(c)
	if !ok {
		return
	}
	snapshot, err := h.sync.GetSnapshot(c.Request.Context(), domainID, snapshotID)
	if err != nil {
		respondError(c, err)
		return
	}
	if snapshot == nil {
		response.NotFound(c, fmt.Sprintf("config snapshot %d not found for network domain %q", snapshotID, domainID))
		return
	}
	response.OK(c, dto.FromConfigSnapshot(snapshot))
}

// Content handles GET /network-domains/:id/config-snapshots/:snapshot_id/content
// (admin only; the payload may contain credentials).
func (h *SnapshotHandler) Content(c *gin.Context) {
	domainID := c.Param("id")
	if _, err := h.onboard.Get(c.Request.Context(), actorOf(c), domainID); err != nil {
		respondError(c, err)
		return
	}
	snapshotID, ok := parseSnapshotID(c)
	if !ok {
		return
	}
	snapshot, raw, err := h.sync.SnapshotContent(c.Request.Context(), domainID, snapshotID)
	if err != nil {
		respondError(c, err)
		return
	}
	if snapshot == nil {
		response.NotFound(c, fmt.Sprintf("config snapshot %d not found for network domain %q", snapshotID, domainID))
		return
	}
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", snapshot.Version+".json"))
	c.Data(http.StatusOK, "application/json", raw)
}

func parseSnapshotID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(c.Param("snapshot_id"), 10, 64)
	if err != nil || id <= 0 {
		response.BadRequest(c, fmt.Errorf("snapshot_id: must be a positive integer"))
		return 0, false
	}
	return id, true
}
