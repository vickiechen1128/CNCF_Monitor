package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ListTenants returns a paginated list of tenants (authorization dictionary
// source for Module_06 §11.2). Response data is `{list, total, page, page_size}`
// to match the platform list envelope used by the frontend tenantApi.
func ListTenants(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page := parseIntDefault(c.Query("page"), 1, 1)
		pageSize := parseIntDefault(c.Query("page_size"), defaultPageSize, 1)
		if pageSize > maxPageSize {
			pageSize = maxPageSize
		}

		q := db.Model(&models.Tenant{})

		if st := c.Query("status"); st != "" {
			q = q.Where("status = ?", st)
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count tenants: %w", err))
			return
		}

		var list []models.Tenant
		if err := q.Order("created_at asc").
			Offset((page - 1) * pageSize).
			Limit(pageSize).
			Find(&list).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list tenants: %w", err))
			return
		}

		if list == nil {
			list = []models.Tenant{}
		}
		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})
	}
}