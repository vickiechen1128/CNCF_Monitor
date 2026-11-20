package models

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
