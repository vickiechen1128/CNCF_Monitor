package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteNetworkDomain soft-deletes an empty network domain. Deletion requires
// no M07 resource references and no managed (non-offline) EdgeAgents; otherwise
// it returns conflict guiding the caller to disable instead. Management domains
// cannot be deleted.
func DeleteNetworkDomain(db *gorm.DB) gin.HandlerFunc {
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

		if dom.IsManagement() {
			response.Conflict(c, fmt.Errorf("management domain %q cannot be deleted", id))
			return
		}

		impact, err := ComputeImpact(db, id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if impact.ResourceCount > 0 || impact.ManagedEdgeAgentCount > 0 {
			response.Conflict(c, fmt.Errorf("network domain %q still has %d resource(s) and %d managed edge agent(s); please disable it instead", id, impact.ResourceCount, impact.ManagedEdgeAgentCount))
			return
		}

		if err := db.Delete(&dom).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("delete network domain %q: %w", id, err))
			return
		}
		response.OK(c, gin.H{"id": id, "deleted": true})
	}
}
