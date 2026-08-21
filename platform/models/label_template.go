package models

// LabelSourceType defines where a label mapping source field comes from.
type LabelSourceType string

// Label source type constants.
const (
	LabelSourceTypeCMDB              LabelSourceType = "cmdb"
	LabelSourceTypePrometheusBuiltin LabelSourceType = "prometheus_builtin"
	LabelSourceTypeComposite         LabelSourceType = "composite"
)

// LabelMapping defines a single source field to Prometheus label mapping.
type LabelMapping struct {
	SourceField string          `json:"source_field"`
	SourceType  LabelSourceType `json:"source_type"`
	TargetLabel string          `json:"target_label"`
	Enabled     bool            `json:"enabled"`
	Transform   string          `json:"transform,omitempty"`
}

// LabelTemplate defines a set of label mappings for a resource type.
//
// This is a Phase 0 skeleton; additional fields will be added in later phases.
type LabelTemplate struct {
	BaseModel
	Name         string         `gorm:"size:100;not null" json:"name"`
	ResourceType ResourceType   `gorm:"size:20;not null" json:"resource_type"`
	JobID        string         `gorm:"size:64" json:"job_id"`
	Mappings     string         `gorm:"type:text" json:"mappings"`
}
