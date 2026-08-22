package models

// ResourceCategory represents the coarse-grained category of a monitored resource.
//
// This is the authoritative five-class enumeration introduced in Phase 0,
// aligned with Module_07 §5.1. The legacy ResourceType is kept as a
// transitional alias and will be removed in a later phase.
type ResourceCategory string

// Resource category constants (五大类权威枚举).
const (
	ResourceCategoryHost          ResourceCategory = "host"
	ResourceCategoryDatabase      ResourceCategory = "database"       // 数据库产品线独立成类
	ResourceCategoryMiddleware    ResourceCategory = "middleware"
	ResourceCategoryApplication   ResourceCategory = "application"
	ResourceCategoryGenericTarget ResourceCategory = "generic_target"
)

// ValidResourceCategories returns the authoritative list of resource categories.
func ValidResourceCategories() []ResourceCategory {
	return []ResourceCategory{
		ResourceCategoryHost,
		ResourceCategoryDatabase,
		ResourceCategoryMiddleware,
		ResourceCategoryApplication,
		ResourceCategoryGenericTarget,
	}
}