package resource

import (
	"net/url"
	"strconv"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 分页常量：PRD §6.1 MVP 分页从简默认 50；03_API_Standard §7.2 上限 100。
const (
	// DefaultPageSize 是列表分页默认每页条数（PRD §6.1：MVP 默认 50）。
	DefaultPageSize = 50
	// MaxPageSize 是每页条数上限，超出钳制到 100。
	MaxPageSize = 100
)

// PageParams 是解析后的分页参数。
type PageParams struct {
	Page     int
	PageSize int
}

// ParsePageParams 解析 page/page_size 查询参数：page 默认 1、page_size 默认 50
// （上限 100，超出钳制到 100）；非法/负数回退默认值。
func ParsePageParams(values url.Values) PageParams {
	page := parseIntDefault(values.Get("page"), 1, 1)
	pageSize := parseIntDefault(values.Get("page_size"), DefaultPageSize, 1)
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	return PageParams{Page: page, PageSize: pageSize}
}

// ListFilter 是五类资源列表共用的筛选条件（PRD §6.1）。
type ListFilter struct {
	NetworkDomainID string
	Keyword         string
	// BizCode 按业务分组编码精确筛选（PRD §11.1 服务端筛选，K-1 闭环）。
	BizCode string
	// Status 按运行状态精确筛选（枚举 online/offline/maintenance，PRD §11.1）。
	Status string
	// IsMonitored 由 M01 维护、M07 只读映射；M01 未实现时透传不生效（见 T07-05）。
	IsMonitored string
	PageParams
}

// ParseListFilter 解析列表查询参数（不含 resource_category：分类路由由 T07-05
// 负责，非法/缺失返回 bad_request）。
func ParseListFilter(values url.Values) ListFilter {
	return ListFilter{
		NetworkDomainID: values.Get("network_domain_id"),
		Keyword:         values.Get("keyword"),
		BizCode:         values.Get("biz_code"),
		Status:          values.Get("status"),
		IsMonitored:     values.Get("is_monitored"),
		PageParams:      ParsePageParams(values),
	}
}

// BuildListQuery 将通用筛选条件拼接到已 Model 到某类资源表的 GORM 查询上：
//
//   - network_domain_id 等值筛选；
//   - biz_code / status 等值筛选（五类资源表均含 biz_code / status 列）；
//   - keyword 对「名称 + IP」做模糊匹配（LIKE），列按类型选取：
//     host=(instance_name, private_ip)、database/middleware=instance_ip、
//     application=(service_name, endpoint)、generic_target=(target_name, instance_ip)；
//   - is_monitored 仅解析透传，M01 未实现时不拼 GORM 条件（见 T07-05）。
//
// 分页（Offset/Limit）由调用方（T07-05 list.go）在 Count 后追加。
func BuildListQuery(db *gorm.DB, category models.ResourceCategory, f ListFilter) *gorm.DB {
	if f.NetworkDomainID != "" {
		db = db.Where("network_domain_id = ?", f.NetworkDomainID)
	}
	if f.BizCode != "" {
		db = db.Where("biz_code = ?", f.BizCode)
	}
	if f.Status != "" {
		db = db.Where("status = ?", f.Status)
	}
	if f.Keyword != "" {
		like := "%" + f.Keyword + "%"
		switch category {
		case models.ResourceCategoryHost:
			// instance_name（hostname）或 private_ip（instance_ip）模糊匹配
			db = db.Where("(instance_name LIKE ? OR private_ip LIKE ?)", like, like)
		case models.ResourceCategoryDatabase, models.ResourceCategoryMiddleware:
			db = db.Where("instance_ip LIKE ?", like)
		case models.ResourceCategoryApplication:
			db = db.Where("(service_name LIKE ? OR endpoint LIKE ?)", like, like)
		case models.ResourceCategoryGenericTarget:
			db = db.Where("(target_name LIKE ? OR instance_ip LIKE ?)", like, like)
		}
	}
	return db
}

// parseIntDefault 解析整型查询参数：空/非法/<min 时返回默认值。
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
