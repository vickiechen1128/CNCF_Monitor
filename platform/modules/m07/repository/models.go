package repository

import (
	"time"

	"gorm.io/gorm"
)

// resourceRecord maps the v3 `resources` table.
type resourceRecord struct {
	ResourceID       string         `gorm:"column:resource_id;primaryKey"`
	ResourceCategory string         `gorm:"column:resource_category;not null"`
	TenantID         string         `gorm:"column:tenant_id;not null"`
	NetworkDomainID  string         `gorm:"column:network_domain_id;not null"`
	BizCode          *string        `gorm:"column:biz_code"`
	AppCode          *string        `gorm:"column:app_code"`
	PlatformCode     *string        `gorm:"column:platform_code"`
	Env              string         `gorm:"column:env;not null"`
	Cluster          *string        `gorm:"column:cluster"`
	Owner            *string        `gorm:"column:owner"`
	Status           string         `gorm:"column:status;not null"`
	SourceType       string         `gorm:"column:source_type;not null"`
	ScrapePort       int            `gorm:"column:scrape_port;not null"`
	DedupKey         string         `gorm:"column:dedup_key;not null"`
	CreatedAt        time.Time      `gorm:"column:created_at"`
	UpdatedAt        time.Time      `gorm:"column:updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (resourceRecord) TableName() string { return "resources" }

type hostRecord struct {
	ResourceID  string     `gorm:"column:resource_id;primaryKey"`
	Hostname    string     `gorm:"column:hostname;not null"`
	InstanceIP  string     `gorm:"column:instance_ip;not null"`
	OSType      string     `gorm:"column:os_type;not null"`
	OSVersion   *string    `gorm:"column:os_version"`
	ActivatedAt *time.Time `gorm:"column:activated_at"`
}

func (hostRecord) TableName() string { return "host_resources" }

type databaseRecord struct {
	ResourceID          string  `gorm:"column:resource_id;primaryKey"`
	DatabaseType        string  `gorm:"column:database_type;not null"`
	InstanceIP          string  `gorm:"column:instance_ip;not null"`
	Port                int     `gorm:"column:port;not null"`
	Version             *string `gorm:"column:version"`
	ConnectionSecretRef *string `gorm:"column:connection_secret_ref"`
}

func (databaseRecord) TableName() string { return "database_resources" }

type middlewareRecord struct {
	ResourceID          string  `gorm:"column:resource_id;primaryKey"`
	MiddlewareType      string  `gorm:"column:middleware_type;not null"`
	InstanceIP          string  `gorm:"column:instance_ip;not null"`
	Port                int     `gorm:"column:port;not null"`
	Version             *string `gorm:"column:version"`
	ConnectionSecretRef *string `gorm:"column:connection_secret_ref"`
}

func (middlewareRecord) TableName() string { return "middleware_resources" }

type applicationRecord struct {
	ResourceID       string     `gorm:"column:resource_id;primaryKey"`
	ServiceName      string     `gorm:"column:service_name;not null"`
	HealthCheckURL   string     `gorm:"column:health_check_url;not null"`
	Protocol         *string    `gorm:"column:protocol"`
	Endpoint         *string    `gorm:"column:endpoint"`
	Port             int        `gorm:"column:port"`
	Owner1           *string    `gorm:"column:owner1"`
	Owner1Contact    *string    `gorm:"column:owner1_contact"`
	Owner2           *string    `gorm:"column:owner2"`
	Owner2Contact    *string    `gorm:"column:owner2_contact"`
	OpsPerson        *string    `gorm:"column:ops_person"`
	OpsPersonContact *string    `gorm:"column:ops_person_contact"`
	GoLiveAt         *time.Time `gorm:"column:go_live_at"`
}

func (applicationRecord) TableName() string { return "application_resources" }

type genericTargetRecord struct {
	ResourceID   string  `gorm:"column:resource_id;primaryKey"`
	TargetName   string  `gorm:"column:target_name;not null"`
	InstanceIP   string  `gorm:"column:instance_ip;not null"`
	Port         int     `gorm:"column:port"`
	MetricsPath  *string `gorm:"column:metrics_path"`
	Scheme       *string `gorm:"column:scheme"`
	ExporterType *string `gorm:"column:exporter_type"`
}

func (genericTargetRecord) TableName() string { return "generic_target_resources" }

type interfaceServiceRecord struct {
	ResourceID string `gorm:"column:resource_id;primaryKey"`
	APIName    string `gorm:"column:api_name;not null"`
	APIURL     string `gorm:"column:api_url;not null"`
}

func (interfaceServiceRecord) TableName() string { return "interface_service_resources" }
