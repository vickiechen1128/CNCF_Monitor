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
// 的 handler：收敛与目标资源类别（+ 同网域）一致的候选实例；offline 显示但置灰
// （决策29）。Query: network_domain_id 必填 + **monitor_type 与 resource_category
// 二选一**（都空 → bad_request；都给 → resource_category 优先）+ keyword + 分页。
//
// resource_category 直查入口：blackbox 拨测任务被强制清空 monitor_type（validate.go），
// 已无法由 monitor_type 推导类别，故拨测以用户在表单选定的类别（现为接口服务 / 应用服务
// 两类）直查候选。候选第二列（InstanceIP）默认返回类别固有的 IP/端点值；拨测入口下
// 未指定 target_field 时，按类别推导出固定的探测地址字段（见下方 targetField 推导）。
func ListInstanceCandidates(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		monitorType := strings.TrimSpace(c.Query("monitor_type"))
		category := strings.TrimSpace(c.Query("resource_category"))
		domainID := c.Query("network_domain_id")
		if domainID == "" {
			response.BadRequest(c, fmt.Errorf("network_domain_id 必填"))
			return
		}
		var deriv models.MonitorTypeDerivation
		if category != "" {
			// resource_category 优先：直查该类别候选（不经 monitor_type 推导）。
			if !validResourceCategory(models.ResourceCategory(category)) {
				response.BadRequest(c, fmt.Errorf("resource_category %q 非法", category))
				return
			}
			deriv = models.MonitorTypeDerivation{Category: models.ResourceCategory(category)}
		} else if monitorType != "" {
			d, ok := models.DeriveResourceFilter(monitorType)
			if !ok {
				response.BadRequest(c, fmt.Errorf("monitor_type %q 无法推导资源类别", monitorType))
				return
			}
			deriv = d
		} else {
			response.BadRequest(c, fmt.Errorf("monitor_type 与 resource_category 至少填一个"))
			return
		}
		p := common.ParsePageParams(c.Request.URL.Query())
		keyword := strings.TrimSpace(c.Query("keyword"))
		// target_field 可选：候选第二列渲染该字段的值，使列表所见与实际探测地址一致。
		targetField := strings.TrimSpace(c.Query("target_field"))
		// 拨测两类可由类别**推导**出唯一字段（接口服务→api_url、应用服务→health_check_url），
		// 故 resource_category 直查入口（= 拨测）下客户端不传也补上，免去前端重复维护
		// 类别↔字段映射。**仅限该入口**：standard 采集也含 application 类别，但其第二列
		// 应是采集端点（applicationTargetAddress 的 endpoint:port），不可换成健康检查 URL。
		if targetField == "" && category != "" {
			if f, ok := models.BlackboxTargetField(deriv.Category); ok {
				targetField = f
			}
		}

		candidates, total, err := queryInstanceCandidates(db, deriv, domainID, keyword, p, targetField)
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

// validResourceCategory 报告 cat 是否为 models.ValidResourceCategories() 权威枚举之一。
func validResourceCategory(cat models.ResourceCategory) bool {
	for _, v := range models.ValidResourceCategories() {
		if v == cat {
			return true
		}
	}
	return false
}

// candidateSecondColumn 返回候选列表第二列（拨测下即列头「探测地址」）的展示值。
//
// 调用方（拨测表单）指定了 target_field 时，取该字段在该资源上的值 —— 即**实际会被
// 探测的地址**，保证列表所见与生成结果一致（否则用户选了「接口名」却看到 api_url）。
// 未指定字段、或该字段取不到值时退回该类别的固有 IP/端点值，避免列表出现空白。
func candidateSecondColumn(res any, fallback, targetField string) string {
	if targetField == "" {
		return fallback
	}
	if v, ok := models.GetResourceField(res, targetField); ok && strings.TrimSpace(v) != "" {
		return v
	}
	return fallback
}

// queryInstanceCandidates 按推导类别查询对应资源表，应用网域 + 子类型 + 关键字筛选，
// 组装 InstanceCandidate 列表。
func queryInstanceCandidates(db *gorm.DB, deriv models.MonitorTypeDerivation, domainID, keyword string, p common.PageParams, targetField string) ([]InstanceCandidate, int64, error) {
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
		case models.ResourceCategoryInterfaceService:
			if keyword != "" {
				q = q.Where("(api_name LIKE ? OR api_url LIKE ?)", "%"+keyword+"%", "%"+keyword+"%")
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
		total, list, err = queryHostCandidates(db, filter, p, targetField)
	case models.ResourceCategoryDatabase:
		total, list, err = queryDatabaseCandidates(db, filter, p, targetField)
	case models.ResourceCategoryMiddleware:
		total, list, err = queryMiddlewareCandidates(db, filter, p, targetField)
	case models.ResourceCategoryApplication:
		total, list, err = queryApplicationCandidates(db, filter, p, targetField)
	case models.ResourceCategoryGenericTarget:
		total, list, err = queryGenericTargetCandidates(db, filter, p, targetField)
	case models.ResourceCategoryInterfaceService:
		total, list, err = queryInterfaceServiceCandidates(db, filter, p, targetField)
	default:
		return nil, 0, fmt.Errorf("未知资源类别 %q", deriv.Category)
	}
	return list, total, err
}

// queryHostCandidates 查询 host 候选。
func queryHostCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams, targetField string) (int64, []InstanceCandidate, error) {
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
			InstanceIP:   candidateSecondColumn(&r, r.PrivateIP, targetField),
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryDatabaseCandidates 查询 database 候选。
func queryDatabaseCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams, targetField string) (int64, []InstanceCandidate, error) {
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
			InstanceIP:   candidateSecondColumn(&r, r.InstanceIP, targetField),
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryMiddlewareCandidates 查询 middleware 候选。
func queryMiddlewareCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams, targetField string) (int64, []InstanceCandidate, error) {
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
			InstanceIP:   candidateSecondColumn(&r, r.InstanceIP, targetField),
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryApplicationCandidates 查询 application 候选。
func queryApplicationCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams, targetField string) (int64, []InstanceCandidate, error) {
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
			InstanceIP:   candidateSecondColumn(&r, applicationTargetAddress(&r), targetField),
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryGenericTargetCandidates 查询 generic_target 候选。
func queryGenericTargetCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams, targetField string) (int64, []InstanceCandidate, error) {
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
			InstanceIP:   candidateSecondColumn(&r, r.InstanceIP, targetField),
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}

// queryInterfaceServiceCandidates 查询 interface_service 候选。展示名列取 api_name，
// 第二列（InstanceIP）取该类别的端点 api_url（接口服务无独立 IP 字段，api_url 即其
// 真实端点；与 queryGenericTargetCandidates 取 InstanceIP 同口径）。
func queryInterfaceServiceCandidates(db *gorm.DB, filter func(*gorm.DB) *gorm.DB, p common.PageParams, targetField string) (int64, []InstanceCandidate, error) {
	q := filter(db.Model(&models.InterfaceService{}))
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return 0, nil, fmt.Errorf("count interface_service candidates: %w", err)
	}
	var rows []models.InterfaceService
	if err := q.Order("created_at desc").Offset((p.Page - 1) * p.PageSize).Limit(p.PageSize).Find(&rows).Error; err != nil {
		return 0, nil, fmt.Errorf("list interface_service candidates: %w", err)
	}
	list := make([]InstanceCandidate, 0, len(rows))
	for _, r := range rows {
		list = append(list, InstanceCandidate{
			ResourceID:   r.GetResourceID(),
			InstanceName: r.APIName,
			InstanceIP:   candidateSecondColumn(&r, r.APIURL, targetField),
			Status:       r.Status,
			Disabled:     r.Status == "offline",
		})
	}
	return total, list, nil
}