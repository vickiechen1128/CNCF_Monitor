// Package models defines the unified data models for MetricCenter.
package models

import (
	"time"

	"gorm.io/gorm"
)

// ResourceType represents the type of a monitored resource.
type ResourceType string

// Resource type constants.
const (
	ResourceTypeHost             ResourceType = "host"
	ResourceTypeDatabase          ResourceType = "database"
	ResourceTypeMiddleware        ResourceType = "middleware"
	ResourceTypeApplication       ResourceType = "application"
	ResourceTypeGenericTarget     ResourceType = "generic_target"
)

// BaseModel provides the common primary key and timestamp fields used by all models.
// It enables soft deletes via DeletedAt.
type BaseModel struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"deleted_at,omitempty"`
}

// Resource is the common interface implemented by all resource types.
type Resource interface {
	GetResourceID() string
	GetResourceType() ResourceType
	GetAppName() string
	GetEnv() string
	GetCluster() string
	GetStatus() string
}

// Middleware represents a middleware resource such as Kafka, Elasticsearch,
// Nginx or Zookeeper (resource_category=middleware). MySQL/Redis now belong to
// Database (see §5.7.1 of Module_07).
type Middleware struct {
	BaseModel
	ResourceID       string       `gorm:"size:64;uniqueIndex:idx_middleware_resource_id" json:"resource_id"`
	ResourceType     ResourceType `gorm:"size:20;not null" json:"resource_type"`
	ResourceCategory ResourceCategory `gorm:"size:30;not null" json:"resource_category"`
	NetworkDomainID  string       `gorm:"size:64;not null;index" json:"network_domain_id"`
	BizCode          string       `gorm:"size:64;not null" json:"biz_code"`
	AppName          string       `gorm:"size:100;not null" json:"app_name"`
	Env              string       `gorm:"size:20;not null" json:"env"`
	Cluster          string       `gorm:"size:100;not null" json:"cluster"`
	Owner            string       `gorm:"size:100" json:"owner"`
	Status           string       `gorm:"size:20;not null" json:"status"`
	MiddlewareType   string       `gorm:"size:50;not null" json:"middleware_type"`
	InstanceIP       string       `gorm:"size:50;not null" json:"instance_ip"`
	Port             int          `json:"port"`
	Version          string       `gorm:"size:50" json:"version"`
	ConnectionString string       `gorm:"size:500" json:"connection_string"`
}

// Application represents an application service resource that can be probed
// (resource_category=application). One row equals one scrapable instance, all
// sharing the same app_name / biz_code.
type Application struct {
	BaseModel
	ResourceID     string       `gorm:"size:64;uniqueIndex:idx_application_resource_id" json:"resource_id"`
	ResourceType   ResourceType `gorm:"size:20;not null" json:"resource_type"`
	ResourceCategory ResourceCategory `gorm:"size:30;not null" json:"resource_category"`
	NetworkDomainID  string     `gorm:"size:64;not null;index" json:"network_domain_id"`
	BizCode          string     `gorm:"size:64;not null" json:"biz_code"`
	AppName        string       `gorm:"size:100;not null" json:"app_name"`
	Env            string       `gorm:"size:20;not null" json:"env"`
	Cluster        string       `gorm:"size:100;not null" json:"cluster"`
	Owner          string       `gorm:"size:100" json:"owner"`
	Status         string       `gorm:"size:20;not null" json:"status"`
	ServiceName    string       `gorm:"size:100;not null" json:"service_name"`
	HealthCheckURL string       `gorm:"size:500;not null" json:"health_check_url"`
	Protocol       string       `gorm:"size:20;not null" json:"protocol"`
	Endpoint       string       `gorm:"size:500" json:"endpoint"`
	Port           int          `json:"port"`
}

// GetResourceID returns the resource id.
func (m *Middleware) GetResourceID() string { return m.ResourceID }

// GetResourceType returns the resource type.
func (m *Middleware) GetResourceType() ResourceType { return ResourceTypeMiddleware }

// GetAppName returns the application name.
func (m *Middleware) GetAppName() string { return m.AppName }

// GetEnv returns the environment.
func (m *Middleware) GetEnv() string { return m.Env }

// GetCluster returns the cluster.
func (m *Middleware) GetCluster() string { return m.Cluster }

// GetStatus returns the resource status.
func (m *Middleware) GetStatus() string { return m.Status }

// GetResourceID returns the resource id.
func (a *Application) GetResourceID() string { return a.ResourceID }

// GetResourceType returns the resource type.
func (a *Application) GetResourceType() ResourceType { return ResourceTypeApplication }

// GetAppName returns the application name.
func (a *Application) GetAppName() string { return a.AppName }

// GetEnv returns the environment.
func (a *Application) GetEnv() string { return a.Env }

// GetCluster returns the cluster.
func (a *Application) GetCluster() string { return a.Cluster }

// GetStatus returns the resource status.
func (a *Application) GetStatus() string { return a.Status }

// GetResourceCategory returns the authoritative resource category.
func (m *Middleware) GetResourceCategory() ResourceCategory { return ResourceCategoryMiddleware }

// GetResourceCategory returns the authoritative resource category.
func (a *Application) GetResourceCategory() ResourceCategory { return ResourceCategoryApplication }
