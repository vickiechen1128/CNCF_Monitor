package inhibition

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/alertmanager/config"
	"github.com/metriccenter/metriccenter/platform/alertmanager/route"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/domainregistry"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"gorm.io/gorm"
)

// Handler adapts inhibition services to HTTP.
type Handler struct {
	svc *Service
}

// NewHandler constructs an inhibition HTTP handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes mounts inhibition read and admin write endpoints.
func RegisterRoutes(platform, admin *gin.RouterGroup, db *gorm.DB) {
	h := NewHandler(NewService(NewRepository(db)))
	platform.GET("/inhibitions", h.List)
	admin.POST("/inhibitions", h.Save)
}

// List handles GET /inhibitions.
func (h *Handler) List(c *gin.Context) {
	view, err := h.svc.List()
	if err != nil {
		response.InternalServerError(c, err)
		return
	}
	response.OK(c, view)
}

type saveRequest struct {
	BaseChecksum string                     `json:"base_checksum"`
	InhibitRules []generator.InhibitionRule `json:"inhibit_rules" binding:"required"`
}

// Save handles POST /inhibitions.
func (h *Handler) Save(c *gin.Context) {
	var req saveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
		return
	}
	result, err := h.svc.Save(req.BaseChecksum, req.InhibitRules, auth.CurrentUsername(c))
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, result)
}

func writeError(c *gin.Context, err error) {
	var validationErr *config.ErrValidation
	var routeErr *route.ErrRouteTreeInvalid
	switch {
	case errors.Is(err, ErrInvalidRule):
		response.BadRequest(c, err)
	case errors.Is(err, route.ErrRoutesConflict):
		response.Conflict(c, err)
	case errors.Is(err, domainregistry.ErrManagementDomainNotRegistered):
		response.Conflict(c, err)
	case errors.As(err, &validationErr), errors.As(err, &routeErr):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}
