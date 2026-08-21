package models

// ScrapeJob defines a Prometheus scrape job configuration.
//
// This is a Phase 0 skeleton; filter rules and full label template associations
// will be expanded in later phases.
type ScrapeJob struct {
	BaseModel
	JobName          string       `gorm:"size:100;uniqueIndex" json:"job_name"`
	ResourceType     ResourceType `gorm:"size:20;not null" json:"resource_type"`
	ScrapeInterval   string       `gorm:"size:20;not null" json:"scrape_interval"`
	ScrapeTimeout    string       `gorm:"size:20;not null" json:"scrape_timeout"`
	MetricsPath      string       `gorm:"size:200;not null" json:"metrics_path"`
	Scheme           string       `gorm:"size:20;not null" json:"scheme"`
	FilterRules      string       `gorm:"type:text" json:"filter_rules"`
	LabelTemplateID  string       `gorm:"size:64" json:"label_template_id"`
	Enabled          bool         `json:"enabled"`
}
