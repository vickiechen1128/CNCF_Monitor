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
	// PlatformCode 按平台归属编码精确筛选（决策 110 / F-18）。
	// 五类资源表均含该列（resource_base.go / host.go / resource.go），无需条件化。
	PlatformCode string
	// AppCode 按应用归属编码精确筛选（决策 92 / F-18）。
	// ⚠️ 物理列名**按类别不同**：host 为 app_code（host.go AppCode），
	// database / middleware / application / generic_target 为 app_name
	// （历史列名，语义已切换为 app_code 编码，见 resource_base.go AppName 注释）。
	// 故列名选择必须按 category 分支，见 BuildListQuery 的 appCodeColumn。
	AppCode string
	// ServiceCode 按服务归属编码精确筛选（决策 105 / F-18）。
	// ⚠️ 仅 application（resource.go ServiceCode）/ generic_target（generic_target.go
	// ServiceCode）两类持有该列；host / database / middleware **无该列**，
	// 必须按 category 条件化追加条件，否则拼该列会直接 SQL 报错。
	ServiceCode string
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
		PlatformCode:    values.Get("platform_code"),
		AppCode:         values.Get("app_code"),
		ServiceCode:     values.Get("service_code"),
		IsMonitored:     values.Get("is_monitored"),
		PageParams:      ParsePageParams(values),
	}
}

// appCodeColumn 返回该类别下承载 app_code 语义的**物理列名**。
//
// 决策 92 只统一了语义（资源侧只存 app_code 编码），未统一物理列名：
//   - host：AppCode → 列 app_code（host.go）
//   - database / middleware / application / generic_target：AppName → 列 app_name
//     （resource_base.go / resource.go，历史列名沿用不改名）
//
// 五类均存在该列，仅列名不同，故按 category 返回而非条件化掉。
//
// **穷举 switch 而非 `if host / else`**（golang-reviewer LOW-1）：原实现的 else 兜底会把
// 未知/新增类别静默落到 `app_name`。若将来新增第 6 类且其 app_code 语义列名为
// `app_code`（如沿用 host 布局），则不报错、但筛选恒空或错筛——属最难排查的一类
// latent bug。改为穷举后，新增枚举会落入 `default` 返回 ""，配合 BuildListQuery 的
// `col != ""` 守卫表现为「不加该条件」，方向与 hasServiceCode 一致且安全。
//
// ⚠️ **新增 ResourceCategory 枚举时必须同步本 switch**（`TestAppCodeColumnCoversAllCategories`
// 已用 `ValidResourceCategories()` 做完整性断言，漏改会测试失败）。
func appCodeColumn(category models.ResourceCategory) string {
	switch category {
	case models.ResourceCategoryHost:
		return "app_code"
	case models.ResourceCategoryDatabase, models.ResourceCategoryMiddleware,
		models.ResourceCategoryApplication, models.ResourceCategoryGenericTarget:
		return "app_name"
	default:
		// 未知类别：不返回任何列名，由调用方跳过该条件（不静默猜列）
		return ""
	}
}

// hasServiceCode 报告该类别是否持有 service_code 列（决策 105）。
// 仅 application / generic_target 两类可挂服务字典归属；
// host / database / middleware 无该列，拼条件会直接 SQL 报错（F-18 核心坑点）。
func hasServiceCode(category models.ResourceCategory) bool {
	switch category {
	case models.ResourceCategoryApplication, models.ResourceCategoryGenericTarget:
		return true
	default:
		return false
	}
}

// BuildListQuery 将通用筛选条件拼接到已 Model 到某类资源表的 GORM 查询上：
//
//   - network_domain_id 等值筛选；
//   - biz_code / status 等值筛选（五类资源表均含 biz_code / status 列）；
//   - platform_code 等值筛选（五类资源表均含该列，决策 110）；
//   - app_code 等值筛选（按 category 取物理列名 app_code / app_name，决策 92）；
//   - service_code 等值筛选（**仅 application / generic_target 追加**，决策 105）；
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
	// 决策 110：平台归属为资源行一等字段，五类表均有 platform_code 列。
	if f.PlatformCode != "" {
		db = db.Where("platform_code = ?", f.PlatformCode)
	}
	// 决策 92：app_code 语义统一但物理列名按类别不同（host=app_code，其余=app_name）。
	// col 为 "" 表示类别未知（appCodeColumn default 分支）→ 不拼条件，
	// 避免用猜测列名拼出恒空/错筛的查询（golang-reviewer LOW-1）。
	if col := appCodeColumn(category); f.AppCode != "" && col != "" {
		db = db.Where(col+" = ?", f.AppCode)
	}
	// 决策 105：service_code 仅 application / generic_target 持有该列，
	// 其余三类必须跳过，否则引用不存在列 → SQL 报错（F-18 回归防护点）。
	if f.ServiceCode != "" && hasServiceCode(category) {
		db = db.Where("service_code = ?", f.ServiceCode)
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
