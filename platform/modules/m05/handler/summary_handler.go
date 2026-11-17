package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/modules/m05/service"
)

// SummaryHandler serves the homepage aggregate.
type SummaryHandler struct {
	svc *service.SummaryService
}

// NewSummaryHandler constructs the summary handler.
func NewSummaryHandler(svc *service.SummaryService) *SummaryHandler {
	return &SummaryHandler{svc: svc}
}

// Get handles GET /dashboard/summary.
//
// The payload is the v2 `dashboard.Summary` struct verbatim, so the existing
// frontend `DashboardSummary` contract keeps working unchanged; only the
// aggregation reads the v3 shared schema.
func (h *SummaryHandler) Get(c *gin.Context) {
	summary, err := h.svc.Build(c.Request.Context())
	if err != nil {
		response.InternalServerError(c, err)
		return
	}
	response.OK(c, summary)
}
