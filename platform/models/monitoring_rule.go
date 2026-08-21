package models

// RuleContentMode defines how a MonitoringRule's content is expressed.
type RuleContentMode string

// Rule content mode constants.
const (
	RuleContentModeYAMLPassthrough RuleContentMode = "yaml_passthrough" // MVP：整文件透传
	RuleContentModeStructured      RuleContentMode = "structured"       // v0.3+：字段级
)

// ScopeType is the rule evaluation scope.
type ScopeType string

// Scope type constants.
const (
	ScopeTypeCentral ScopeType = "central" // MVP~v0.3 固定
	ScopeTypeEdge    ScopeType = "edge"    // v0.4+
	ScopeTypeBoth    ScopeType = "both"    // v0.4+
)

// MonitoringRule represents a Prometheus rule (alerting/recording) mounted at
// the central evaluator, aligned with Module_01 §5.5. MVP uses whole-file
// YAML passthrough (content_mode=yaml_passthrough).
type MonitoringRule struct {
	BaseModel
	Name           string          `gorm:"size:100" json:"name"` // 展示名
	ContentMode    RuleContentMode `gorm:"size:30;not null" json:"content_mode"`
	RuleContent    string          `gorm:"type:text" json:"rule_content,omitempty"` // yaml_passthrough 必填
	RuleType       string          `gorm:"size:20" json:"rule_type,omitempty"`      // alerting/recording（structured）
	Expr           string          `gorm:"type:text" json:"expr,omitempty"`
	Duration       string          `gorm:"size:20" json:"duration,omitempty"`
	Labels         map[string]string `gorm:"serializer:json" json:"labels,omitempty"`
	Annotations    map[string]string `gorm:"serializer:json" json:"annotations,omitempty"`
	MonitorType    string          `gorm:"size:64" json:"monitor_type,omitempty"`
	ExporterTemplateID string      `gorm:"size:64" json:"exporter_template_id,omitempty"`
	Scope          ScopeType       `gorm:"size:20;not null" json:"scope"`
	Enabled        bool            `json:"enabled"`
	DraftStatus    string          `gorm:"size:20;not null" json:"draft_status"` // draft/ready
	ChangeStatus   ChangeStatus    `gorm:"size:20;not null" json:"change_status"`
}