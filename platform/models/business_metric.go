package models

// BusinessMetricSource represents how a business metric was registered.
type BusinessMetricSource string

// Business metric source constants.
const (
	BusinessMetricSourceSelf  BusinessMetricSource = "self"
	BusinessMetricSourceAgent BusinessMetricSource = "agent"
)

// BusinessMetricStatus represents the instrumentation status.
type BusinessMetricStatus string

// Business metric status constants.
const (
	BusinessMetricStatusPending       BusinessMetricStatus = "pending"
	BusinessMetricStatusInstrumented  BusinessMetricStatus = "instrumented"
	BusinessMetricStatusOnline        BusinessMetricStatus = "online"
)

// BusinessMetric is a P2-reserved semantic contract for business metrics,
// aligned with Module_01 §5.9. It is modeled only; no UI / routing is planned
// in Phase 0.
type BusinessMetric struct {
	BaseModel
	MetricID            string               `gorm:"size:64;not null;uniqueIndex" json:"metric_id"`
	MetricName          string               `gorm:"size:200;not null" json:"metric_name"`
	Description         string               `gorm:"type:text;not null" json:"description"`
	MetricType          string               `gorm:"size:20;not null" json:"metric_type"` // counter/gauge/histogram/summary
	Unit                string               `gorm:"size:50" json:"unit,omitempty"`
	BusinessDomain      string               `gorm:"size:64;not null" json:"business_domain"`
	AppName             string               `gorm:"size:100" json:"app_name,omitempty"`
	ThresholdSuggestion string               `gorm:"size:500" json:"threshold_suggestion,omitempty"`
	Owner               string               `gorm:"size:100;not null" json:"owner"`
	RegisterSource      BusinessMetricSource `gorm:"size:20;not null" json:"register_source"`
	Status              BusinessMetricStatus `gorm:"size:20;not null" json:"status"`
}

// TableName returns the GORM table name.
func (BusinessMetric) TableName() string { return "business_metrics" }