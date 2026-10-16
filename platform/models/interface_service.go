package models

// InterfaceService 代表「接口服务」资源（resource_category=interface_service，
// 第 6 类资源）：对外提供的业务接口，用于拨测（blackbox 探活）可用性。
//
// 归属字段只暴露网域（必填）/ 业务（必填）/ 应用（必填）/ 运行状态；嵌入
// ResourceBase 以复用公共列与 6 个 Resource 接口方法，其余列（cloud_code /
// platform_code / env / cluster / owner / scrape_port 等）保留但不在 UI 暴露，
// 沿用既有默认值。
//
// APIURL 是**完整 URL**（含 `?` 查询参数），拨测目标地址直接取该值 ——
// 不拼端口、不经 instanceAddress（见 configcenter/generator/targets.go）。
type InterfaceService struct {
	BaseModel
	ResourceBase
	APIName      string       `gorm:"size:200;not null" json:"api_name"`
	APIURL       string       `gorm:"size:500;not null" json:"api_url"`
	ResourceType ResourceType `gorm:"size:20;not null" json:"resource_type"` // 过渡字段：固定 = resource_category
}

// GetResourceType returns the resource type (transitional, equals the category).
func (o *InterfaceService) GetResourceType() ResourceType {
	return ResourceType(ResourceCategoryInterfaceService)
}

// GetResourceCategory returns the authoritative resource category.
func (o *InterfaceService) GetResourceCategory() ResourceCategory {
	return ResourceCategoryInterfaceService
}
