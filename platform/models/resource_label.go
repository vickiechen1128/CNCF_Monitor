package models

// LabelSource represents the source of a resource label.
type LabelSource string

// Label source constants.
const (
	LabelSourceSystem LabelSource = "system"
	LabelSourceUser   LabelSource = "user"
	LabelSourceCMDB   LabelSource = "cmdb" // v0.4+
)

// ResourceLabel associates a single key/value label with a resource, aligned
// with Module_07 §5.3.
//
// Key rules: lowercase letters, digits and underscores; must not start with
// "__"; must not overwrite built-in Prometheus labels (instance/job/scheme/
// __address__ etc.).
//
// (resource_id, key, source) 唯一索引（dev-feedback L-3）：同一资源同一 key
// 每来源至多一条，消除「先查后插」的并发重复竞态；system 标签实时计算不落库，
// 故仅约束 user / cmdb 来源的库内记录。
type ResourceLabel struct {
	BaseModel
	ResourceID string      `gorm:"size:64;not null;index:idx_resource_label_resource,priority:1;uniqueIndex:idx_resource_label_uniq,priority:1" json:"resource_id"`
	Key        string      `gorm:"size:128;not null;uniqueIndex:idx_resource_label_uniq,priority:2" json:"key"`
	Value      string      `gorm:"size:1000" json:"value"`
	Source     LabelSource `gorm:"size:20;not null;uniqueIndex:idx_resource_label_uniq,priority:3" json:"source"`
}