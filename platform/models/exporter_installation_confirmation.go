package models

import "time"

// InstallationStatus is the exporter installation-confirmation state, unified
// with Module_01 §8 (用户决策：修正 §5.6 枚举)。
type InstallationStatus string

// Installation status constants.
const (
	InstallationStatusUnconfirmed   InstallationStatus = "unconfirmed"
	InstallationStatusConfirmed     InstallationStatus = "confirmed"
	InstallationStatusNotApplicable InstallationStatus = "not_applicable"
)

// ExporterInstallationConfirmation 是实例级采集器安装确认记录（Module_01 §5.6，
// 维度以 §6.2.5 + §8 ④为准）。主键维度 = (resource_id, scrape_job_id)，
// FK scrape_job_id → ScrapeJob.id；exporter_template_id 为冗余缓存（来自 ScrapeJob，
// 不参与唯一）。
type ExporterInstallationConfirmation struct {
	ResourceID         string             `gorm:"primaryKey;size:64" json:"resource_id"`
	ScrapeJobID        uint               `gorm:"primaryKey" json:"scrape_job_id"`               // FK → ScrapeJob.id
	ExporterTemplateID string             `gorm:"size:64" json:"exporter_template_id,omitempty"` // 冗余缓存
	Status             InstallationStatus `gorm:"size:20;not null" json:"status"`
	ConfirmedBy        string             `gorm:"size:100" json:"confirmed_by"`
	ConfirmedAt        *time.Time         `json:"confirmed_at,omitempty"`
	Notes              string             `gorm:"size:500" json:"notes"`
	ActualPort         int                `json:"actual_port"` // P1：实际监听端口
	CreatedAt          time.Time          `json:"created_at"`
	UpdatedAt          time.Time          `json:"updated_at"`
}

// TableName returns the GORM table name for an ExporterInstallationConfirmation.
func (ExporterInstallationConfirmation) TableName() string {
	return "exporter_installation_confirmations"
}
