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
type ResourceLabel struct {
	BaseModel
	ResourceID string `gorm:"size:64;not null;index:idx_resource_label_resource" json:"resource_id"`
	Key        string `gorm:"size:128;not null" json:"key"`
	Value      string `gorm:"size:1000" json:"value"`
	Source     LabelSource `gorm:"size:20;not null" json:"source"`
}