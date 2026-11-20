package models

// MetricType is the Prometheus metric type, aligned with Module_01 §5.3.
type MetricType string

// Metric type constants.
const (
	MetricTypeCounter   MetricType = "counter"
	MetricTypeGauge     MetricType = "gauge"
	MetricTypeHistogram MetricType = "histogram"
	MetricTypeSummary   MetricType = "summary"
	MetricTypeUnknown   MetricType = "unknown"
)

// ExporterMetricAnchor 是技术指标库的分组锚点：指标的采集模板归属 + 来源采集器
// 标注（解决同名不同义，Module_01 §5.3）。
type ExporterMetricAnchor struct {
	TemplateCode   string `json:"template_code"`
	SourceExporter string `json:"source_exporter,omitempty"`
}

// ExporterMetricLibrary defines a technical metric metadata entry, aligned with
// Module_01 §5.3. 指标 ↔ 采集模板为多对多（collection_templates 锚点）。
type ExporterMetricLibrary struct {
	BaseModel
	MetricName          string                 `gorm:"size:200;not null;index" json:"metric_name"`
	MetricType          MetricType             `gorm:"size:20;not null" json:"metric_type"`
	Help                string                 `gorm:"type:text" json:"help"`
	Unit                string                 `gorm:"size:50" json:"unit"`
	Labels              []string               `gorm:"serializer:json" json:"labels"`
	CollectionTemplates []ExporterMetricAnchor `gorm:"serializer:json" json:"collection_templates"`
	Category            string                 `gorm:"size:50" json:"category"`                       // 语义域（P1 可选）：cpu/memory/disk/network...
	ExporterTemplateID  string                 `gorm:"size:64" json:"exporter_template_id,omitempty"` // 建议采集器（可空，仅技术信息）
	IsBuiltin           bool                   `json:"is_builtin"`
	Enabled             bool                   `json:"enabled"`
}

// TableName returns the GORM table name for an ExporterMetricLibrary.
func (ExporterMetricLibrary) TableName() string { return "exporter_metric_library" }
