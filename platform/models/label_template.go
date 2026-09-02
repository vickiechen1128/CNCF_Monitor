package models

// LabelSourceType defines where a label mapping source field comes from,
// aligned with Module_07 §5.11.
type LabelSourceType string

// Label source type constants.
const (
	LabelSourceTypeResourceField      LabelSourceType = "resource_field"
	LabelSourceTypeComposite          LabelSourceType = "composite"
	LabelSourceTypePrometheusBuiltin  LabelSourceType = "prometheus_builtin"
	LabelSourceTypeCMDB               LabelSourceType = "cmdb_field" // v0.4+
)

// LabelMapping defines a single source field to Prometheus label mapping,
// aligned with Module_07 §5.11.
type LabelMapping struct {
	SourceField string          `json:"source_field"`
	SourceType  LabelSourceType `json:"source_type"`
	TargetLabel string          `json:"target_label"`
	Enabled     bool            `json:"enabled"`
	Transform   string          `json:"transform,omitempty"` // lower/upper/prefix/replace，空=原样
}

// LabelTemplate defines a set of label mappings anchored at a coarse-grained
// resource category, aligned with Module_07 §5.10. The legacy job_id field has
// been removed; ScrapeJob references a LabelTemplate instead.
type LabelTemplate struct {
	BaseModel
	Name             string           `gorm:"size:100;not null" json:"name"`
	ResourceCategory ResourceCategory `gorm:"size:30;not null;index" json:"resource_category"`
	IsDefault        bool             `json:"is_default"`
	Mappings         []LabelMapping   `gorm:"serializer:json" json:"mappings"`
}

// DefaultMappingBuilders returns the default field→label mappings for a given
// resource category, aligned with Module_07 §5.13.
func DefaultMappingBuilders(category ResourceCategory) []LabelMapping {
	if category == ResourceCategoryApplication {
		// application default template has no composite→instance mapping; endpoint
		// carries its own port (Module_07 §5.13).
		return []LabelMapping{
			{SourceField: "resource_id", SourceType: LabelSourceTypeResourceField, TargetLabel: "resource_id", Enabled: true},
			{SourceField: "service_name", SourceType: LabelSourceTypeResourceField, TargetLabel: "service_name", Enabled: true},
			{SourceField: "app_name", SourceType: LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
			{SourceField: "env", SourceType: LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
			{SourceField: "cluster", SourceType: LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
			{SourceField: "biz_code", SourceType: LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
			{SourceField: "health_check_url", SourceType: LabelSourceTypeResourceField, TargetLabel: "health_check_url", Enabled: true},
		}
	}

	// host / database / middleware / generic_target share the composite→instance
	// built-in mapping plus common resource-field mappings.
	return []LabelMapping{
		{SourceField: "instance_ip:port", SourceType: LabelSourceTypeComposite, TargetLabel: "instance", Enabled: true},
		{SourceField: "resource_id", SourceType: LabelSourceTypeResourceField, TargetLabel: "resource_id", Enabled: true},
		{SourceField: "app_name", SourceType: LabelSourceTypeResourceField, TargetLabel: "app", Enabled: true},
		{SourceField: "env", SourceType: LabelSourceTypeResourceField, TargetLabel: "env", Enabled: true},
		{SourceField: "cluster", SourceType: LabelSourceTypeResourceField, TargetLabel: "cluster", Enabled: true},
		{SourceField: "biz_code", SourceType: LabelSourceTypeResourceField, TargetLabel: "biz", Enabled: true},
	}
}