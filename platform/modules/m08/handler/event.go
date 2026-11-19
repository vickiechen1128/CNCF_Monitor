package handler

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m08/service"
)

// EventHandler exposes current/historical alerts (FR-23..25).
type EventHandler struct{ svc *service.EventService }

// NewEventHandler constructs the handler.
func NewEventHandler(svc *service.EventService) *EventHandler { return &EventHandler{svc: svc} }

// List handles GET /alertmanager/alert-events.
func (h *EventHandler) List(c *gin.Context) {
	page, pageSize := parsePagination(c)
	statusGroup := strings.TrimSpace(c.Query("status_group"))
	if statusGroup != "" && statusGroup != "open" {
		response.BadRequest(c, fmt.Errorf("status_group 仅支持 open"))
		return
	}
	status := domain.EventStatus(strings.TrimSpace(c.Query("status")))
	if status != "" && !domain.IsValidEventStatus(status) {
		response.BadRequest(c, fmt.Errorf("status %q 非法", status))
		return
	}
	filter := repository.EventFilter{
		Status: status, StatusGroup: statusGroup,
		Severity:      strings.TrimSpace(c.Query("severity")),
		AlertName:     strings.TrimSpace(c.Query("alert_name")),
		Summary:       strings.TrimSpace(c.Query("summary")),
		Description:   strings.TrimSpace(c.Query("description")),
		NetworkDomain: strings.TrimSpace(c.Query("network_domain")),
		Sort:          strings.TrimSpace(c.Query("sort")),
		Page:          page, PageSize: pageSize,
	}
	if filter.Sort != "" {
		low := strings.ToLower(filter.Sort)
		if low != "starts_at asc" && low != "starts_at desc" {
			response.BadRequest(c, fmt.Errorf("sort 仅支持 starts_at asc / starts_at desc"))
			return
		}
		filter.Sort = low
	}
	var err error
	if filter.StartsFrom, err = parseOptionalTime(c.Query("starts_from")); err != nil {
		response.BadRequest(c, err)
		return
	}
	if filter.StartsTo, err = parseOptionalTime(c.Query("starts_to")); err != nil {
		response.BadRequest(c, err)
		return
	}
	if filter.EndsFrom, err = parseOptionalTime(c.Query("ends_from")); err != nil {
		response.BadRequest(c, err)
		return
	}
	if filter.EndsTo, err = parseOptionalTime(c.Query("ends_to")); err != nil {
		response.BadRequest(c, err)
		return
	}
	views, total, err := h.svc.List(c.Request.Context(), filter)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.EventListResponse{
		List: eventsToDTO(views), Total: total, Page: page, PageSize: pageSize,
	})
}

// Current handles GET /alertmanager/alert-events/current.
func (h *EventHandler) Current(c *gin.Context) {
	views, err := h.svc.Current(c.Request.Context(), strings.TrimSpace(c.Query("network_domain")))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, gin.H{"list": eventsToDTO(views), "total": len(views)})
}

// Stats handles GET /alertmanager/alert-events/stats (frozen field set).
func (h *EventHandler) Stats(c *gin.Context) {
	stats, err := h.svc.Stats(c.Request.Context(), strings.TrimSpace(c.Query("network_domain")))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, stats)
}

func eventsToDTO(views []service.EventView) []dto.EventResponse {
	list := make([]dto.EventResponse, 0, len(views))
	now := time.Now().UTC()
	for _, view := range views {
		list = append(list, dto.FromEvent(view.Event, dto.EventInstance{
			InstanceAddress: view.Instance.Address, InstanceDisplay: view.Instance.Display,
			ResourceID: view.Instance.ResourceID, ResourceName: view.Instance.Name,
			ResourceCategory: view.Instance.Category,
		}, now))
	}
	return list
}

// AlertsHandler exposes the Alertmanager notification-status proxy (FR-26).
type AlertsHandler struct{ client *service.AMClient }

// NewAlertsHandler constructs the handler.
func NewAlertsHandler(client *service.AMClient) *AlertsHandler { return &AlertsHandler{client: client} }

// List handles GET /alertmanager/alerts.
func (h *AlertsHandler) List(c *gin.Context) {
	if h.client == nil {
		response.ServiceUnavailable(c, fmt.Errorf("alertmanager url not configured"))
		return
	}
	alerts, err := h.client.ActiveAlerts(c.Request.Context())
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]gin.H, 0, len(alerts))
	for _, alert := range alerts {
		list = append(list, gin.H{
			"labels": alert.Labels, "annotations": alert.Annotations,
			"starts_at": alert.StartsAt, "ends_at": alert.EndsAt,
			"state": alert.Status.State, "notify_status": notifyStatus(alert),
			"silenced_by": alert.Status.SilencedBy, "inhibited_by": alert.Status.InhibitedBy,
			"fingerprint": alert.FingerprintKey(),
		})
	}
	response.OK(c, gin.H{"list": list, "total": len(list)})
}

// notifyStatus collapses AM state + suppression targets into the four contract
// states (active / silenced / inhibited / unprocessed).
func notifyStatus(alert service.AMAlert) string {
	switch {
	case len(alert.Status.InhibitedBy) > 0:
		return "inhibited"
	case len(alert.Status.SilencedBy) > 0:
		return "silenced"
	case alert.Status.State == "unprocessed":
		return "unprocessed"
	default:
		return "active"
	}
}
