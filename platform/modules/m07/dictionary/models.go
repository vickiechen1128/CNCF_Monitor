package dictionary

import (
	"time"

	"gorm.io/gorm"
)

type businessDomainRecord struct {
	Code        string         `gorm:"column:code;primaryKey"`
	Name        string         `gorm:"column:name"`
	Description *string        `gorm:"column:description"`
	Enabled     bool           `gorm:"column:enabled"`
	MergedInto  *string        `gorm:"column:merged_into"`
	RevokedAt   *time.Time     `gorm:"column:revoked_at"`
	CreatedAt   time.Time      `gorm:"column:created_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (businessDomainRecord) TableName() string { return "business_domains" }

type applicationDictRecord struct {
	AppCode     string         `gorm:"column:app_code;primaryKey"`
	AppName     string         `gorm:"column:app_name"`
	Description *string        `gorm:"column:description"`
	Status      string         `gorm:"column:status"`
	MergedInto  *string        `gorm:"column:merged_into"`
	RevokedAt   *time.Time     `gorm:"column:revoked_at"`
	CreatedAt   time.Time      `gorm:"column:created_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (applicationDictRecord) TableName() string { return "application_dicts" }

type platformDictRecord struct {
	PlatformCode string         `gorm:"column:platform_code;primaryKey"`
	PlatformName string         `gorm:"column:platform_name"`
	Description  *string        `gorm:"column:description"`
	Enabled      bool           `gorm:"column:enabled"`
	MergedInto   *string        `gorm:"column:merged_into"`
	RevokedAt    *time.Time     `gorm:"column:revoked_at"`
	CreatedAt    time.Time      `gorm:"column:created_at"`
	UpdatedAt    time.Time      `gorm:"column:updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (platformDictRecord) TableName() string { return "platform_dicts" }

type cloudDictRecord struct {
	CloudCode   string     `gorm:"column:cloud_code;primaryKey"`
	CloudName   string     `gorm:"column:cloud_name"`
	CloudType   string     `gorm:"column:cloud_type"`
	Carrier     string     `gorm:"column:carrier"`
	Description *string    `gorm:"column:description"`
	Enabled     bool       `gorm:"column:enabled"`
	MergedInto  *string    `gorm:"column:merged_into"`
	RevokedAt   *time.Time `gorm:"column:revoked_at"`
	UpdatedAt   time.Time  `gorm:"column:updated_at"`
}

func (cloudDictRecord) TableName() string { return "cloud_dicts" }

type zoneTypeRecord struct {
	Code        string     `gorm:"column:code;primaryKey"`
	DisplayName string     `gorm:"column:display_name"`
	Enabled     bool       `gorm:"column:enabled"`
	MergedInto  *string    `gorm:"column:merged_into"`
	RevokedAt   *time.Time `gorm:"column:revoked_at"`
	UpdatedAt   time.Time  `gorm:"column:updated_at"`
}

func (zoneTypeRecord) TableName() string { return "zone_types" }

type networkDomainRecord struct {
	ID         string         `gorm:"column:id;primaryKey"`
	DomainType string         `gorm:"column:domain_type"`
	ZoneType   string         `gorm:"column:zone_type"`
	CloudCode  string         `gorm:"column:cloud_code"`
	Status     string         `gorm:"column:status"`
	UpdatedAt  time.Time      `gorm:"column:updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (networkDomainRecord) TableName() string { return "network_domains" }

type appPlatformRelRecord struct {
	ID           string         `gorm:"column:id;primaryKey"`
	AppCode      string         `gorm:"column:app_code"`
	PlatformCode string         `gorm:"column:platform_code"`
	IsPrimary    bool           `gorm:"column:is_primary"`
	CreatedAt    time.Time      `gorm:"column:created_at"`
	UpdatedAt    time.Time      `gorm:"column:updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (appPlatformRelRecord) TableName() string { return "app_platform_rels" }

type dictionaryAuditLogRecord struct {
	ID             string    `gorm:"column:id;primaryKey"`
	DictionaryType string    `gorm:"column:dictionary_type"`
	Action         string    `gorm:"column:action"`
	SourceCode     string    `gorm:"column:source_code"`
	TargetCode     string    `gorm:"column:target_code"`
	ReferenceCount int64     `gorm:"column:reference_count"`
	Operator       string    `gorm:"column:operator"`
	Detail         string    `gorm:"column:detail"`
	CreatedAt      time.Time `gorm:"column:created_at"`
}

func (dictionaryAuditLogRecord) TableName() string { return "m07_dictionary_audit_logs" }
