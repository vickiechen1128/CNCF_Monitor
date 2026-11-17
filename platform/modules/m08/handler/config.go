package handler

import (
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// ConfigHandler exposes the configuration lifecycle endpoints (FR-05..08).
type ConfigHandler struct{ svc *service.ConfigService }

// NewConfigHandler constructs the handler.
func NewConfigHandler(svc *service.ConfigService) *ConfigHandler { return &ConfigHandler{svc: svc} }

// Current handles GET /alertmanager/config.
func (h *ConfigHandler) Current(c *gin.Context) {
	snapshot, err := h.svc.Current(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	rules, err := h.svc.EnabledRules(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	out := dto.SnapshotResponse{
		ID: strconv.FormatInt(snapshot.ID, 10), Version: snapshot.Version,
		Checksum: snapshot.Checksum, Content: snapshot.Content, RouteTree: snapshot.RouteTree,
		IsCurrent: snapshot.IsCurrent, GeneratedBy: snapshot.GeneratedBy,
		GeneratedAt: snapshot.GeneratedAt,
	}
	for _, rule := range rules {
		out.InhibitRules = append(out.InhibitRules, dto.FromInhibition(rule))
	}
	if latest, ok, err := h.svc.LatestReload(c.Request.Context()); err == nil && ok {
		at := latest.FinishedAt
		if at == nil {
			at = &latest.StartedAt
		}
		out.Reload = &dto.ReloadSummary{
			Status: string(latest.Status), Trigger: string(latest.Trigger),
			DurationMS: latest.DurationMS, At: at,
		}
	}
	response.OK(c, out)
}

// ListVersions handles GET /alertmanager/config/versions.
func (h *ConfigHandler) ListVersions(c *gin.Context) {
	page, pageSize := parsePagination(c)
	items, total, err := h.svc.ListVersions(c.Request.Context(), page, pageSize)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.SnapshotListItem, 0, len(items))
	for _, item := range items {
		list = append(list, dto.SnapshotListItem{
			ID: strconv.FormatInt(item.ID, 10), Version: item.Version,
			Checksum: item.Checksum, IsCurrent: item.IsCurrent,
			GeneratedBy: item.GeneratedBy, GeneratedAt: item.GeneratedAt,
		})
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// GetVersion handles GET /alertmanager/config/versions/{id}.
func (h *ConfigHandler) GetVersion(c *gin.Context) {
	id, ok := parsePathID(c, "id")
	if !ok {
		return
	}
	snapshot, err := h.svc.GetVersion(c.Request.Context(), id)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.SnapshotResponse{
		ID: strconv.FormatInt(snapshot.ID, 10), Version: snapshot.Version,
		Checksum: snapshot.Checksum, Content: snapshot.Content, RouteTree: snapshot.RouteTree,
		IsCurrent: snapshot.IsCurrent, GeneratedBy: snapshot.GeneratedBy,
		GeneratedAt: snapshot.GeneratedAt,
	})
}

// ReloadLogs handles GET /alertmanager/config/reload-logs.
func (h *ConfigHandler) ReloadLogs(c *gin.Context) {
	page, pageSize := parsePagination(c)
	logs, total, err := h.svc.ReloadLogs(c.Request.Context(), page, pageSize)
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.ReloadLogResponse, 0, len(logs))
	for _, entry := range logs {
		list = append(list, dto.ReloadLogResponse{
			ID: strconv.FormatInt(entry.ID, 10), ConfigVersion: entry.ConfigVersion,
			Checksum: entry.Checksum, Status: string(entry.Status), Trigger: string(entry.Trigger),
			Operator: entry.Operator, DurationMS: entry.DurationMS, StartedAt: entry.StartedAt,
			FinishedAt: entry.FinishedAt, Error: entry.Error,
		})
	}
	response.OK(c, gin.H{"list": list, "total": total, "page": page, "page_size": pageSize})
}

// Reload handles POST /alertmanager/config/reload (manual replay, D-M08-06).
func (h *ConfigHandler) Reload(c *gin.Context) {
	result, err := h.svc.ReloadCurrent(c.Request.Context(), operatorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	at := result.At
	response.OK(c, dto.ReloadSummary{
		Status: string(result.Status), Trigger: string(domain.ReloadTriggerManual),
		DurationMS: result.DurationMS, At: &at,
	})
}

// RouteHandler exposes the routing tree (FR-13/14).
type RouteHandler struct{ svc *service.ConfigService }

// NewRouteHandler constructs the handler.
func NewRouteHandler(svc *service.ConfigService) *RouteHandler { return &RouteHandler{svc: svc} }

// Get handles GET /alertmanager/routes.
func (h *RouteHandler) Get(c *gin.Context) {
	snapshot, err := h.svc.Current(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.RouteTreeResponse{RouteTree: snapshot.RouteTree, BaseChecksum: snapshot.Checksum})
}

// Save handles POST /alertmanager/routes.
func (h *RouteHandler) Save(c *gin.Context) {
	var req dto.SaveRouteRequest
	if err := bindJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	outcome, err := h.svc.SaveRoutes(c.Request.Context(), req.BaseChecksum, req.RouteTree, operatorOf(c))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, saveResult(outcome))
}

func saveResult(outcome *service.SaveOutcome) dto.SaveResult {
	at := outcome.Reload.At
	return dto.SaveResult{
		ConfigChecksum: outcome.Checksum, ConfigVersion: outcome.Version,
		PendingSections: outcome.PendingSections,
		Reload: &dto.ReloadSummary{
			Status: string(outcome.Reload.Status), DurationMS: outcome.Reload.DurationMS,
			At: timeOrNil(at),
		},
		SnapshotSynced: outcome.SnapshotSynced,
	}
}

func timeOrNil(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}
