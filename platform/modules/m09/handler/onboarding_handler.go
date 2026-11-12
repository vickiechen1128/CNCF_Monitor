package handler

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

// OnboardingHandler exposes the M09 v3 onboarding API.
type OnboardingHandler struct {
	svc *service.OnboardingService
}

// NewOnboardingHandler constructs the onboarding handler.
func NewOnboardingHandler(svc *service.OnboardingService) *OnboardingHandler {
	return &OnboardingHandler{svc: svc}
}

// List handles GET /network-domains. Without a view it returns the onboarding
// scope (enabled edge domains); `view=admin` (or an explicit status) returns
// the administrative scope for administrators (D34).
func (h *OnboardingHandler) List(c *gin.Context) {
	status := strings.TrimSpace(c.Query("registration_status"))
	if status != "" && !validRegistrationStatus(status) {
		response.BadRequest(c, fmt.Errorf(
			"registration_status: invalid value %q: must be created, monitored or retired", status))
		return
	}
	view := strings.TrimSpace(c.Query("view"))
	switch view {
	case "":
	case service.ViewOnboarding, service.ViewAdmin:
	default:
		response.BadRequest(c, fmt.Errorf("view: invalid value %q: must be onboarding or admin", view))
		return
	}
	adminStatus := strings.TrimSpace(c.Query("status"))
	if adminStatus != "" && adminStatus != "enabled" && adminStatus != "disabled" {
		response.BadRequest(c, fmt.Errorf("status: invalid value %q: must be enabled or disabled", adminStatus))
		return
	}
	if adminStatus != "" {
		if view == service.ViewOnboarding {
			response.BadRequest(c, fmt.Errorf("status requires view=admin"))
			return
		}
		if view == "" {
			view = service.ViewAdmin
		}
	}
	page, pageSize := parsePagination(c)
	items, total, err := h.svc.List(c.Request.Context(), actorOf(c), repository.ListFilter{
		RegistrationStatus: status,
		Keyword:            strings.TrimSpace(c.Query("keyword")),
		CloudCode:          strings.TrimSpace(c.Query("cloud_code")),
		ZoneType:           strings.TrimSpace(c.Query("zone_type")),
		TenantID:           strings.TrimSpace(c.Query("tenant_id")),
		View:               view,
		Status:             adminStatus,
		Page:               page,
		PageSize:           pageSize,
	})
	if err != nil {
		respondError(c, err)
		return
	}
	list := make([]dto.OnboardingResponse, 0, len(items))
	for i := range items {
		list = append(list, dto.FromOnboarding(&items[i]))
	}
	response.OK(c, dto.ListOnboardingResponse{List: list, Total: total, Page: page, PageSize: pageSize})
}

// Get handles GET /network-domains/:id.
func (h *OnboardingHandler) Get(c *gin.Context) {
	item, err := h.svc.Get(c.Request.Context(), actorOf(c), c.Param("id"))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromOnboarding(item))
}

// Monitor handles POST /network-domains/:id/monitor (admin).
func (h *OnboardingHandler) Monitor(c *gin.Context) {
	center := centerEndpoint(c)
	ep := service.Endpoint{CenterEndpoint: center}
	if center != "" {
		ep.RemoteWriteURL = center + "/api/v1/write"
	}
	result, err := h.svc.Monitor(c.Request.Context(), actorOf(c), c.Param("id"), ep)
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromMonitorResult(result))
}

// ResetToken handles POST /network-domains/:id/token/reset (admin).
func (h *OnboardingHandler) ResetToken(c *gin.Context) {
	result, err := h.svc.ResetToken(c.Request.Context(), actorOf(c), c.Param("id"))
	if err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.FromResetToken(result))
}

// Unmonitor handles DELETE /network-domains/:id/monitor (admin).
func (h *OnboardingHandler) Unmonitor(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.Unmonitor(c.Request.Context(), actorOf(c), id); err != nil {
		respondError(c, err)
		return
	}
	response.OK(c, dto.UnmonitorResponse{
		NetworkDomainID:    id,
		RegistrationStatus: string(domain.RegistrationStatusCreated),
	})
}

// actorOf derives the caller's authorization scope from the authenticated user.
func actorOf(c *gin.Context) service.Actor {
	user := auth.CurrentUser(c)
	if user == nil {
		return service.Actor{}
	}
	return service.Actor{
		TenantID:        user.TenantID,
		IsPlatformAdmin: user.Role == models.UserRoleAdmin,
	}
}

func validRegistrationStatus(value string) bool {
	switch domain.RegistrationStatus(value) {
	case domain.RegistrationStatusCreated, domain.RegistrationStatusMonitored, domain.RegistrationStatusRetired:
		return true
	default:
		return false
	}
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

// centerEndpoint derives the externally reachable center base URL from the
// request, honouring reverse-proxy headers.
func centerEndpoint(c *gin.Context) string {
	scheme := "http"
	if proto := c.GetHeader("X-Forwarded-Proto"); proto != "" {
		scheme = proto
	} else if c.Request.TLS != nil {
		scheme = "https"
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}
	return scheme + "://" + host
}
