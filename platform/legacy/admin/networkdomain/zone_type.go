package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ZoneTypeView is the public projection of a zone_type dictionary entry.
// Only enabled entries are returned; Enabled is always true here but kept so
// the frontend's presence filter stays self-consistent.
type ZoneTypeView struct {
	Code        string `json:"code"`
	DisplayName string `json:"display_name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
}

// ListZoneTypes returns only the enabled, deployment-level zone_type
// dictionary entries as a flat array `[{code, display_name, description}]`.
func ListZoneTypes(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var zones []models.ZoneType
		if err := db.Where("enabled = ?", true).Order("code asc").Find(&zones).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list zone types: %w", err))
			return
		}

		items := make([]ZoneTypeView, 0, len(zones))
		for _, z := range zones {
			items = append(items, ZoneTypeView{
				Code:        z.Code,
				DisplayName: z.DisplayName,
				Description: z.Description,
				Enabled:     true,
			})
		}
		response.OK(c, items)
	}
}
