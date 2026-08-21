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
	ResourceTypeHost         ResourceType = "host"
	ResourceTypeMiddleware   ResourceType = "middleware"
	ResourceTypeApplication  ResourceType = "application"
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

// Middleware represents a middleware resource such as MySQL, Redis or Kafka.
type Middleware struct {
	BaseModel
	ResourceID       string       `gorm:"size:64;uniqueIndex:idx_middleware_resource_id" json:"resource_id"`
	ResourceType     ResourceType `gorm:"size:20;not null" json:"resource_type"`
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

// Application represents an application service resource that can be probed.
type Application struct {
	BaseModel
	ResourceID     string       `gorm:"size:64;uniqueIndex:idx_application_resource_id" json:"resource_id"`
	ResourceType   ResourceType `gorm:"size:20;not null" json:"resource_type"`
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
