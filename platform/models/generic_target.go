package models

// GenericTarget represents a generic/exporter resource (resource_category=
// generic_target), aligned with Module_07 §5.9.
type GenericTarget struct {
	BaseModel
	ResourceBase
	TargetName   string            `gorm:"size:200;not null" json:"target_name"`
	InstanceIP   string            `gorm:"size:50;not null" json:"instance_ip"`
	Port         int               `json:"port"`
	MetricsPath  string            `gorm:"size:200" json:"metrics_path"`  // 默认 /metrics
	Scheme       string            `gorm:"size:20" json:"scheme"`         // 默认 http
	ExporterType string            `gorm:"size:100" json:"exporter_type"` // 如 snmp_exporter
	CustomLabels map[string]string `gorm:"serializer:json" json:"custom_labels"`
	ResourceType ResourceType      `gorm:"size:20;not null" json:"resource_type"` // 过渡字段
}

// GetResourceType returns the resource type (transitional, equals the category).
func (g *GenericTarget) GetResourceType() ResourceType { return ResourceType(ResourceCategoryGenericTarget) }

// GetResourceCategory returns the authoritative resource category.
func (g *GenericTarget) GetResourceCategory() ResourceCategory { return ResourceCategoryGenericTarget }