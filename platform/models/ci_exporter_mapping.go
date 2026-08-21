package models

import "time"

// CITypeExporterMapping links a fine-grained monitor_type to its default
// exporter template and campaign defaults, aligned with Module_01 §5.1.
type CITypeExporterMapping struct {
	BaseModel
	MonitorType        string `gorm:"size:64;not null;index" json:"monitor_type"` // host_linux/mysql/redis/...
	ExporterTemplateID string `gorm:"size:64;not null" json:"exporter_template_id"`
	IsDefault          bool   `gorm:"index" json:"is_default"` // 该 monitor_type 下默认采集实现
	DefaultPort        int    `json:"default_port"`
	MetricsPath        string `gorm:"size:200;not null" json:"metrics_path"`
	Scheme             string `gorm:"size:20;not null" json:"scheme"`
	ScrapeInterval     string `gorm:"size:20;not null" json:"scrape_interval"` // 默认 15s/30s/60s
	ScrapeTimeout      string `gorm:"size:20;not null" json:"scrape_timeout"`
	LabelTemplateID    string `gorm:"size:64" json:"label_template_id,omitempty"` // 可空
	IsBuiltin          bool   `json:"is_builtin"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// TableName returns the GORM table name.
func (CITypeExporterMapping) TableName() string { return "ci_type_exporter_mappings" }