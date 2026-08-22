package models

// ResourceStatus represents the runtime status of a monitored resource,
// aligned with Module_07 §5.2/§5.5.
type ResourceStatus string

// Resource status constants.
const (
	ResourceStatusOnline      ResourceStatus = "online"
	ResourceStatusOffline     ResourceStatus = "offline"
	ResourceStatusMaintenance ResourceStatus = "maintenance"
)

// ResourceStatusMapping maps an external (Excel/CMDB) source status value to
// the canonical Resource.status enumeration, aligned with Module_07 §5.5.3.
type ResourceStatusMapping struct {
	BaseModel
	SourceStatus     string           `gorm:"size:100;not null;index" json:"source_status"`
	TargetStatus     ResourceStatus   `gorm:"size:20;not null" json:"target_status"`
	ResourceCategory *ResourceCategory `gorm:"size:30" json:"resource_category,omitempty"` // nil = 通用
	Priority         int              `json:"priority"`                                    // 数值大的优先
	IsBuiltin        bool             `json:"is_builtin"`
	Enabled          bool             `json:"enabled"`
}

// DefaultStatusMappings returns the built-in default mappings from
// Module_07 §5.5.1.
func DefaultStatusMappings() []ResourceStatusMapping {
	return []ResourceStatusMapping{
		{SourceStatus: "运行中|正常|online|active|running|up", TargetStatus: ResourceStatusOnline, Priority: 100, IsBuiltin: true, Enabled: true},
		{SourceStatus: "已停止|停止|offline|stopped|down|关机", TargetStatus: ResourceStatusOffline, Priority: 100, IsBuiltin: true, Enabled: true},
		{SourceStatus: "维护中|维修中|maintenance|maintaining", TargetStatus: ResourceStatusMaintenance, Priority: 90, IsBuiltin: true, Enabled: true},
	}
}