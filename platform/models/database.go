package models

// Database represents a database resource (resource_category=database),
// aligned with Module_07 §5.7.1. The legacy ResourceType column is kept for
// backward compatibility.
type Database struct {
	BaseModel
	ResourceBase
	DatabaseType     string `gorm:"size:50" json:"database_type"` // mysql/redis/postgresql/oracle/dm8/sqlserver/mongodb
	InstanceIP       string `gorm:"size:50;not null" json:"instance_ip"`
	Port             int    `json:"port"`
	Version          string `gorm:"size:50" json:"version"`
	ConnectionString string `gorm:"size:500" json:"connection_string"`
	ResourceType     ResourceType `gorm:"size:20;not null" json:"resource_type"` // 过渡字段：固定 = resource_category
}

// GetResourceType returns the resource type (transitional, equals the category).
func (d *Database) GetResourceType() ResourceType { return ResourceType(ResourceCategoryDatabase) }

// GetResourceCategory returns the authoritative resource category.
func (d *Database) GetResourceCategory() ResourceCategory { return ResourceCategoryDatabase }