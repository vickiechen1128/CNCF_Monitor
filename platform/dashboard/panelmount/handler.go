package panelmount

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
)

// Handler adapts dashboard panel services to HTTP.
type Handler struct {
	svc *Service
}

// NewHandler constructs a dashboard panel HTTP handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

type createPanelRequest struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type panelDTO struct {
	ID        uint      `json:"id"`
	Name      string    `json:"name"`
	URL       string    `json:"url"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toPanelDTO(panel *models.DashboardPanel) panelDTO {
	return panelDTO{
		ID: panel.ID, Name: panel.Name, URL: panel.URL,
		CreatedAt: panel.CreatedAt, UpdatedAt: panel.UpdatedAt,
	}
}

// Create handles POST /dashboard/panels.
func (h *Handler) Create(c *gin.Context) {
	var req createPanelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("invalid request payload: %w", err))
		return
	}
	panel, err := h.svc.Create(req.Name, req.URL)
	if err != nil {
		writePanelError(c, err)
		return
	}
	response.OK(c, toPanelDTO(panel))
}

// List handles GET /dashboard/panels.
func (h *Handler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	panels, total, err := h.svc.List(page, pageSize)
	if err != nil {
		writePanelError(c, err)
		return
	}
	items := make([]panelDTO, 0, len(panels))
	for i := range panels {
		items = append(items, toPanelDTO(&panels[i]))
	}
	response.OK(c, gin.H{"list": items, "total": total, "page": page, "page_size": pageSize})
}

// Get handles GET /dashboard/panels/:id.
func (h *Handler) Get(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		response.BadRequest(c, fmt.Errorf("invalid dashboard panel id"))
		return
	}
	panel, err := h.svc.Get(uint(id))
	if err != nil {
		writePanelError(c, err)
		return
	}
	response.OK(c, toPanelDTO(panel))
}

func writePanelError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidPanel):
		response.BadRequest(c, err)
	case errors.Is(err, ErrNameConflict):
		response.Conflict(c, err)
	case errors.Is(err, ErrPanelNotFound):
		response.NotFound(c, err.Error())
	default:
		response.InternalServerError(c, err)
	}
}
