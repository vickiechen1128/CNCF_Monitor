package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// UpdateNetworkDomainRequest accepts only the editable administrative fields.
// tenant_id/id/status/domain_type are intentionally not part of the struct and
// are therefore ignored if present in the request body (registration ownership
// and domain type are immutable after creation).
type UpdateNetworkDomainRequest struct {
	Name                *string  `json:"name"`
	Description         *string  `json:"description"`
	ZoneType            *string  `json:"zone_type"`
	AuthorizedTenantIDs []string `json:"authorized_tenant_ids"`
}

// UpdateNetworkDomain edits editable fields using .Select to limit the columns,
// preserving tenant_id and domain_type.
func UpdateNetworkDomain(db *gorm.DB) gin.HandlerFunc {
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

		var req UpdateNetworkDomainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid network domain payload: %w", err))
			return
		}

		cols := make([]string, 0, 4)
		if req.Name != nil {
			dom.Name = *req.Name
			cols = append(cols, "name")
		}
		if req.Description != nil {
			dom.Description = *req.Description
			cols = append(cols, "description")
		}
		if req.ZoneType != nil {
			dom.ZoneType = *req.ZoneType
			cols = append(cols, "zone_type")
		}
		if req.AuthorizedTenantIDs != nil {
			dom.AuthorizedTenantIDs = req.AuthorizedTenantIDs
			cols = append(cols, "authorized_tenant_ids")
		}

		if len(cols) > 0 {
			if err := db.Model(&dom).Select(cols).Updates(&dom).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("update network domain %q: %w", id, err))
				return
			}
			if req.AuthorizedTenantIDs != nil {
				if err := syncAuthorizedTenants(db, id, dom.AuthorizedTenantIDs); err != nil {
					response.InternalServerError(c, err)
					return
				}
			}
			// Reload to reflect the persisted values.
			if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("reload network domain %q: %w", id, err))
				return
			}
		}
		response.OK(c, dom)
	}
}
