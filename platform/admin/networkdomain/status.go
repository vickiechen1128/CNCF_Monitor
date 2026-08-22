package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// UpdateStatusRequest carries the target administrative status.
type UpdateStatusRequest struct {
	Status models.DomainStatus `json:"status" binding:"required"`
}

func validDomainStatus(s models.DomainStatus) bool {
	return s == models.DomainStatusEnabled || s == models.DomainStatusDisabled
}

// UpdateDomainStatus enables/disables a domain. Disabling is a freeze: the
// response carries the flat impact scope `{resource_count,
// managed_edge_agent_count}`. Management domains cannot be disabled.
func UpdateDomainStatus(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var dom models.NetworkDomain
		if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("network domain %q not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get network domain %q: %w", id, err))
			return
		}

		var req UpdateStatusRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid status payload: %w", err))
			return
		}
		if !validDomainStatus(req.Status) {
			response.BadRequest(c, fmt.Errorf("invalid status %q: must be enabled or disabled", req.Status))
			return
		}

		// Enabling is un-freezing; no impact scope is needed.
		if req.Status == models.DomainStatusEnabled {
			dom.Status = models.DomainStatusEnabled
			if err := db.Model(&dom).Update("status", dom.Status).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("enable network domain %q: %w", id, err))
				return
			}
			response.OK(c, gin.H{"id": id, "status": req.Status})
			return
		}

		// Disabling (= freeze): management domains cannot be disabled.
		if dom.IsManagement() {
			response.Conflict(c, fmt.Errorf("management domain %q cannot be disabled", id))
			return
		}

		impact, err := ComputeImpact(db, id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if err := db.Model(&dom).Update("status", models.DomainStatusDisabled).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("disable network domain %q: %w", id, err))
			return
		}
		// Flat impact scope, per the frontend contract.
		response.OK(c, gin.H{
			"id":                       id,
			"status":                   models.DomainStatusDisabled,
			"resource_count":           impact.ResourceCount,
			"managed_edge_agent_count": impact.ManagedEdgeAgentCount,
		})
	}
}
