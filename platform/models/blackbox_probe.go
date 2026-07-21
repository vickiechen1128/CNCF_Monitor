package models

// BlackboxProbeConfig defines a Blackbox Exporter probe configuration.
//
// This is a Phase 0 skeleton; target resolution and module details will be
// expanded in later phases.
type BlackboxProbeConfig struct {
	BaseModel
	JobName        string `gorm:"size:100;uniqueIndex" json:"job_name"`
	Module         string `gorm:"size:50;not null" json:"module"`
	Targets        string `gorm:"type:text;not null" json:"targets"`
	ScrapeInterval string `gorm:"size:20;not null" json:"scrape_interval"`
	Enabled        bool   `json:"enabled"`
}
