package scrapejob

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/common"
	"gorm.io/gorm"
)

// InstanceCandidate 是实例候选查询结果 item（api-contract-snapshot §6）。
type InstanceCandidate struct {
	ResourceID   string `json:"resource_id"`
	InstanceName string `json:"instance_name"`
	InstanceIP   string `json:"instance_ip"`
	Status       string `json:"status"`
	Disabled     bool   `json:"disabled"` // status=offline 时置灰不可选
}

// ListInstanceCandidates 是 GET /api/v2/platform/scrape-jobs/instance-candidates
// 的 handler：同 monitor_type（推导资源类别）+ 同网域收敛候选实例；offline 显示但
// 置灰（决策29）。Query: monitor_type/network_domain_id 必填 + keyword + page/page_size。
func ListInstanceCandidates(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		monitorType := c.Query("monitor_type")
		domainID := c.Query("network_domain_id")
		if monitorType == "" || domainID == "" {
			response.BadRequest(c, fmt.Errorf("monitor_type 与 network_domain_id 必填"))
			return
		}
		deriv, ok := models.DeriveResourceFilter(monitorType)
		if !ok {
			response.BadRequest(c, fmt.Errorf("monitor_type %q 无法推导资源类别", monitorType))
			return
		}
		p := common.ParsePageParams(c.Request.URL.Query())
		keyword := strings.TrimSpace(c.Query("keyword"))

		candidates, total, err := queryInstanceCandidates(db, deriv, domainID, keyword, p)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{
			"list":      candidates,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}

// queryInstanceCandidates 按推导类别查询对应资源表，应用网域 + 子类型 + 关键字筛选，
// 组装 InstanceCandidate 列表。
func queryInstanceCandidates(db *gorm.DB, deriv models.MonitorTypeDerivation, domainID, keyword string, p common.PageParams) ([]InstanceCandidate, int64, error) {
	filter := func(q *gorm.DB) *gorm.DB {
		q = q.Where("network_domain_id = ?", domainID)
		switch deriv.Category {
		case models.ResourceCategoryHost:
			// os_type 由 Image 承载，按 OSKeywords 关键词匹配。
			qs := q
			var conds []string
			for range deriv.OSKeywords {
				conds = append(conds, "LOWER(image) LIKE ?")
			}
			args := make([]interface{}, 0, len(deriv.OSKeywords))
			for _, kw := range deriv.OSKeywords {
				args = append(args, "%"+strings.ToLower(kw)+"%")
			}
			qs = qs.Where(strings.Join(conds, " OR "), args...)
			if keyword != "" {
				qs = qs.Where("(instance_name LIKE ? OR private_ip LIKE ? OR server_id LIKE ?)", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
			}
			return qs
		case models.ResourceCategoryDatabase:
			q = q.Where("database_type = ?", deriv.Subtype)
			if keyword != "" {
				q = q.Where("(instance_ip LIKE ?)", "%"+keyword+"%")
			}
			return q
		case models.ResourceCategoryMiddleware:
			q = q.Where("middleware_type = ?", deriv.Subtype)
			if keyword != "" {
				q = q.Where("(app_name LIKE ? OR instance_ip LIKE ?)", "%"+keyword+"%", "%"+keyword+"%")
			}
			return q
		default:
			if keyword != "" {
				q = q.Where("(resource_id LIKE ?)", "%"+keyword+"%")
			}
			return q
		}
	}

	var total int64
	var list []InstanceCandidate
	var err error

	switch deriv.Category {
	case models.ResourceCategoryHost:
		total, list, err = queryHostCandidates(db, filter, p)
	case models.ResourceCategoryDatabase:
		total, list, err = queryDatabaseCandidates(db, filter, p)
	case models.ResourceCategoryMiddleware:
		total, list, err = queryMiddlewareCandidates(db, filter, p)
	case models.ResourceCategoryApplication:
		total, list, err = queryApplicationCandidates(db, filter, p)
	case models.ResourceCategoryGenericTarget:
		total, list, err = queryGenericTargetCandidates(db, filter, p)
	default:
		return nil, 0, fmt.Errorf("未知资源类别 %q", deriv.Category)
	}
	return list, total, err
}

// queryHostCandidates 查询 host 候选。
func queryHostCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, error) {
	q := filter(db.Model(&models.Host{}))
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count host candidates: %w", err)
	}
	var rows []models.Host
	if err := q.Order("created_at desc").Offset((p.Page - 1) * p.PageSize).Limit(p.PageSize).Find(&rows).Error; err != nil {
		return 0, nil, fmt.Errorf("list host candidates: %w", err)
	}
	list := make([]InstanceCandidate, 0, len(rows))
	for _, r := range rows {
		list = append(list, InstanceCandidate{
			ResourceID:   r.GetResourceID(),
			InstanceName: r.InstanceName,
			InstanceIP:   r.PrivateIP,
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryDatabaseCandidates 查询 database 候选。
func queryDatabaseCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, error) {
	q := filter(db.Model(&models.Database{}))
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count database candidates: %w", err)
	}
	var rows []models.Database
	if err := q.Order("created_at desc").Offset((p.Page - 1) * p.PageSize).Limit(p.PageSize).Find(&rows).Error; err != nil {
		return 0, nil, fmt.Errorf("list database candidates: %w", err)
	}
	list := make([]InstanceCandidate, 0, len(rows))
	for _, r := range rows {
		list = append(list, InstanceCandidate{
			ResourceID:   r.GetResourceID(),
			InstanceName: r.ResourceID,
			InstanceIP:   r.InstanceIP,
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryMiddlewareCandidates 查询 middleware 候选。
func queryMiddlewareCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, error) {
	q := filter(db.Model(&models.Middleware{}))
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count middleware candidates: %w", err)
	}
	var rows []models.Middleware
	if err := q.Order("created_at desc").Offset((p.Page - 1) * p.PageSize).Limit(p.PageSize).Find(&rows).Error; err != nil {
		return 0, nil, fmt.Errorf("list middleware candidates: %w", err)
	}
	list := make([]InstanceCandidate, 0, len(rows))
	for _, r := range rows {
		list = append(list, InstanceCandidate{
			ResourceID:   r.GetResourceID(),
			InstanceName: r.AppName,
			InstanceIP:   r.InstanceIP,
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryApplicationCandidates 查询 application 候选。
func queryApplicationCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, error) {
	q := filter(db.Model(&models.Application{}))
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count application candidates: %w", err)
	}
	var rows []models.Application
	if err := q.Order("created_at desc").Offset((p.Page - 1) * p.PageSize).Limit(p.PageSize).Find(&rows).Error; err != nil {
		return 0, nil, fmt.Errorf("list application candidates: %w", err)
	}
	list := make([]InstanceCandidate, 0, len(rows))
	for _, r := range rows {
		list = append(list, InstanceCandidate{
			ResourceID:   r.GetResourceID(),
			InstanceName: r.ServiceName,
			InstanceIP:   r.HealthCheckURL,
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryGenericTargetCandidates 查询 generic_target 候选。
func queryGenericTargetCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams) (int64, []InstanceCandidate, error) {
	q := filter(db.Model(&models.GenericTarget{}))
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count generic_target candidates: %w", err)
	}
	var rows []models.GenericTarget
	if err := q.Order("created_at desc").Offset((p.Page - 1) * p.PageSize).Limit(p.PageSize).Find(&rows).Error; err != nil {
		return 0, nil, fmt.Errorf("list generic_target candidates: %w", err)
	}
	list := make([]InstanceCandidate, 0, len(rows))
	for _, r := range rows {
		list = append(list, InstanceCandidate{
			ResourceID:   r.GetResourceID(),
			InstanceName: r.TargetName,
			InstanceIP:   r.InstanceIP,
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}