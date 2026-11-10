package dictionary

import "gorm.io/gorm"

type businessDomainRecord struct {
	Code    string `gorm:"column:code;primaryKey"`
	Name    string `gorm:"column:name"`
	Enabled bool   `gorm:"column:enabled"`
}

func (businessDomainRecord) TableName() string { return "business_domains" }

type applicationDictRecord struct {
	AppCode string `gorm:"column:app_code;primaryKey"`
	AppName string `gorm:"column:app_name"`
	Status  string `gorm:"column:status"`
}

func (applicationDictRecord) TableName() string { return "application_dicts" }

type platformDictRecord struct {
	PlatformCode string `gorm:"column:platform_code;primaryKey"`
	PlatformName string `gorm:"column:platform_name"`
	Enabled      bool   `gorm:"column:enabled"`
}

func (platformDictRecord) TableName() string { return "platform_dicts" }

type cloudDictRecord struct {
	CloudCode string `gorm:"column:cloud_code;primaryKey"`
	CloudName string `gorm:"column:cloud_name"`
	Enabled   bool   `gorm:"column:enabled"`
}

func (cloudDictRecord) TableName() string { return "cloud_dicts" }

type zoneTypeRecord struct {
	Code        string `gorm:"column:code;primaryKey"`
	DisplayName string `gorm:"column:display_name"`
	Enabled     bool   `gorm:"column:enabled"`
}

func (zoneTypeRecord) TableName() string { return "zone_types" }

type networkDomainRecord struct {
	ID        string         `gorm:"column:id;primaryKey"`
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (networkDomainRecord) TableName() string { return "network_domains" }

type appPlatformRelRecord struct {
	AppCode      string         `gorm:"column:app_code"`
	PlatformCode string         `gorm:"column:platform_code"`
	IsPrimary    bool           `gorm:"column:is_primary"`
	DeletedAt    gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (appPlatformRelRecord) TableName() string { return "app_platform_rels" }
