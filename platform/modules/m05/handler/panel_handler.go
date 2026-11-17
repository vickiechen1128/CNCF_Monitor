package handler

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m05/service"
)

// PanelHandler serves the mounted Grafana panel registry (M05 FR-08).
type PanelHandler struct {
	svc *service.PanelService
}

// NewPanelHandler constructs the panel handler.
func NewPanelHandler(svc *service.PanelService) *PanelHandler {
	return &PanelHandler{svc: svc}
}

// panelRequest is the create / update body (only name and url are mutable).
type panelRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// panelDTO is the wire shape of one panel. Times are time.Time so they encode
// as RFC3339 (frontend `DashboardPanel.created_at` / `updated_at`).
type panelDTO struct {
	ID        uint      `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toPanelDTO(panel domain.Panel) panelDTO {
	return panelDTO{
		ID:        panel.ID,
		Name:      panel.Name,
		URL:       panel.URL,
		CreatedAt: panel.CreatedAt,
		UpdatedAt: panel.UpdatedAt,
	}
}

// List handles GET /dashboard/panels.
//
// Paging envelope {list,total,page,page_size}: page defaults to 1, page_size to
// 20 and is capped at 100. Invalid values behave like absent ones (defaults).
func (h *PanelHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := h.svc.List(c.Request.Context(), page, pageSize)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	list := make([]panelDTO, 0, len(result.Items))
	for _, panel := range result.Items {
		list = append(list, toPanelDTO(panel))
	}
	response.OK(c, gin.H{
		"list":      list,
		"total":     result.Total,
		"page":      result.Page,
		"page_size": result.PageSize,
	})
}

// Get handles GET /dashboard/panels/:id.
func (h *PanelHandler) Get(c *gin.Context) {
	id, err := parsePanelID(c.Param("id"))
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	panel, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, toPanelDTO(panel))
}

// Create handles POST /dashboard/panels (admin only).
func (h *PanelHandler) Create(c *gin.Context) {
	var req panelRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	panel, err := h.svc.Create(c.Request.Context(), domain.CreatePanelInput{Name: req.Name, URL: req.URL})
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, toPanelDTO(panel))
}

// Update handles PUT /dashboard/panels/:id (admin only); id / created_at stay.
func (h *PanelHandler) Update(c *gin.Context) {
	id, err := parsePanelID(c.Param("id"))
	if err != nil {
		response.BadRequest(c, err)
		return
	}
	var req panelRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	panel, err := h.svc.Update(c.Request.Context(), id, domain.UpdatePanelInput{Name: req.Name, URL: req.URL})
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, toPanelDTO(panel))
}

// parsePanelID converts the :id path param; 0 / non-numeric is a 400 (the same
// behaviour as the v2 panel handler).
func parsePanelID(raw string) (uint, error) {
	id, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || id == 0 {
		return 0, fmt.Errorf("invalid dashboard panel id")
	}
	return uint(id), nil
}

// decodeStrictJSON decodes the request body and rejects unknown fields so typos
// in the payload fail fast instead of being silently ignored.
func decodeStrictJSON(c *gin.Context, target any) error {
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}
