package models

import "strings"

// ResourceCategory represents the coarse-grained category of a monitored resource.
//
// This is the authoritative five-class enumeration introduced in Phase 0,
// aligned with Module_07 §5.1. The legacy ResourceType is kept as a
// transitional alias and will be removed in a later phase.
type ResourceCategory string

// Resource category constants (资源类别权威枚举).
const (
	ResourceCategoryHost          ResourceCategory = "host"
	ResourceCategoryDatabase      ResourceCategory = "database" // 数据库产品线独立成类
	ResourceCategoryMiddleware    ResourceCategory = "middleware"
	ResourceCategoryApplication   ResourceCategory = "application"
	ResourceCategoryGenericTarget ResourceCategory = "generic_target"
	// ResourceCategoryInterfaceService 是第 6 类资源「接口服务」（对外提供的
	// 业务接口，用于拨测可用性）。
	//
	// ⚠️ 新类别必须**追加到末尾**：ValidResourceCategories() 的顺序即契约，
	// dashboard/summary.go 的 resourceModels() 按下标与之对齐 —— 两处不同序追加
	// 会导致类别张冠李戴且不报错。
	ResourceCategoryInterfaceService ResourceCategory = "interface_service"
)

// ValidResourceCategories returns the authoritative list of resource categories.
//
// 顺序即契约：调用方若按下标与另一份等长列表对齐（如 dashboard/summary.go 的
// resourceModels()），新类别必须同样追加到末尾。
func ValidResourceCategories() []ResourceCategory {
	return []ResourceCategory{
		ResourceCategoryHost,
		ResourceCategoryDatabase,
		ResourceCategoryMiddleware,
		ResourceCategoryApplication,
		ResourceCategoryGenericTarget,
		ResourceCategoryInterfaceService,
	}
}

// CategoriesHint 返回斜杠分隔的资源类别清单（如 "host/database/…"），供错误提示
// 文案使用。
//
// **必须**从 ValidResourceCategories() 派生：此前 8 处提示文案各自硬编码了类别名，
// 新增第 6 类时全部漏改，用户会看到「可选 host/database/middleware/application/
// generic_target」这种把新类别排除在外的引导。改用本函数后，新增类别文案自动跟随。
func CategoriesHint() string {
	cats := ValidResourceCategories()
	parts := make([]string, 0, len(cats))
	for _, c := range cats {
		parts = append(parts, string(c))
	}
	return strings.Join(parts, "/")
}

// BlackboxProbeCategories 返回支持拨测（blackbox）的资源类别，顺序即前端下拉展示顺序。
//
// 只有这两类：二者的地址字段本身就是**完整 URL**，可直接当拨测目标；其余类别
// （host/database/middleware/generic_target）的地址是 IP / 端点，要拨测得另拼协议与
// 端口，且组件连通性拨测另有归属，故已退出拨测范围（2026-10-16 口径收紧，见
// docs/05-execution-records/module-07/dev-feedback.md F-31）。
func BlackboxProbeCategories() []ResourceCategory {
	return []ResourceCategory{ResourceCategoryInterfaceService, ResourceCategoryApplication}
}

// BlackboxTargetField 返回拨测下某资源类别**固定**的探测地址字段键，ok=false 表示该
// 类别不支持拨测。
//
// 字段不交给用户选：接口服务取「接口地址」api_url、应用服务取「健康检查 URL」
// health_check_url。二者与 ResourceCategory 一对一，故无需（也不应）让客户端传
// target_field —— 保存时由 validateJobRequest 按类别推导并覆盖。
//
// 返回的键必须存在于 LegacyFieldMap(cat)（models.GetResourceField 依赖其做名→列映射）。
func BlackboxTargetField(cat ResourceCategory) (string, bool) {
	switch cat {
	case ResourceCategoryInterfaceService:
		return "api_url", true
	case ResourceCategoryApplication:
		return "health_check_url", true
	}
	return "", false
}

// BlackboxCategoriesHint 返回支持拨测的类别清单（斜杠分隔），供错误提示文案使用。
// 与 CategoriesHint 同理：必须从 BlackboxProbeCategories() 派生，避免新增类别时漏改文案。
func BlackboxCategoriesHint() string {
	cats := BlackboxProbeCategories()
	parts := make([]string, 0, len(cats))
	for _, c := range cats {
		parts = append(parts, string(c))
	}
	return strings.Join(parts, "/")
}
