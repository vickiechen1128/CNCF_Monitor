package networkdomain

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// ListNetworkDomains returns a paginated, filterable list of network domains.
// Response data is `{list, total, page, page_size}` (API Standard §7.2).
func ListNetworkDomains(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page := parseIntDefault(c.Query("page"), 1, 1)
		pageSize := parseIntDefault(c.Query("page_size"), defaultPageSize, 1)
		if pageSize > maxPageSize {
			pageSize = maxPageSize
		}

		q := db.Model(&models.NetworkDomain{})

		if tenantID := c.Query("tenant_id"); tenantID != "" {
			// tenant sees the domain when it is the registry owner OR an
			// authorized tenant; authorized_tenant_ids is a JSON array column.
			pattern := `%"` + tenantID + `"%`
			q = q.Where("tenant_id = ? OR authorized_tenant_ids LIKE ?", tenantID, pattern)
		}
		if zt := c.Query("zone_type"); zt != "" {
			q = q.Where("zone_type = ?", zt)
		}
		if st := c.Query("status"); st != "" {
			q = q.Where("status = ?", st)
		}
		if name := c.Query("name"); name != "" {
			q = q.Where("name LIKE ?", "%"+name+"%")
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count network domains: %w", err))
			return
		}

		var list []models.NetworkDomain
		// 排序：系统预置管理域（default，中心直连域）固定置顶；其余按登记先后升序，
		// 保证新登记网域追加在列表末尾而非插入最先（PM 决策 2026-09-17）。
		if err := q.Order("(domain_type = 'management') desc, created_at asc").
			Offset((page - 1) * pageSize).
			Limit(pageSize).
			Find(&list).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list network domains: %w", err))
			return
		}

		if list == nil {
			list = []models.NetworkDomain{}
		}
		views, err := DomainListView(db, list)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("aggregate domain access progress: %w", err))
			return
		}
		response.OK(c, gin.H{
			"list":      views,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})
	}
}

func parseIntDefault(raw string, def, min int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < min {
		return def
	}
	return v
}
