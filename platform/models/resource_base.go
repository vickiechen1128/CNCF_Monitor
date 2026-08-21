package models

// SourceType represents the data source of a resource.
type SourceType string

// Source type constants.
const (
	SourceTypeManual SourceType = "manual"
	SourceTypeImport SourceType = "import"
	SourceTypeCMDB   SourceType = "cmdb" // v0.4+
)

// ResourceBase carries the shared field set for the five resource categories,
// aligned with Module_07 §5.2. It is intended to be embedded by concrete
// resource models (Database / GenericTarget); existing models keep their
// legacy layout and add the shared columns explicitly.
type ResourceBase struct {
	ResourceID       string           `gorm:"size:64;uniqueIndex" json:"resource_id"` // uuid，创建后不可变
	ResourceCategory ResourceCategory `gorm:"size:30;not null" json:"resource_category"`
	NetworkDomainID  string           `gorm:"size:64;not null;index" json:"network_domain_id"`
	BizCode          string           `gorm:"size:64;not null" json:"biz_code"` // 业务归属编码，必填（MVP）
	AppName          *string          `gorm:"size:100" json:"app_name,omitempty"`         // host/generic_target 可空
	Env              string           `gorm:"size:20;not null" json:"env"`
	Cluster          *string          `gorm:"size:100" json:"cluster,omitempty"`
	Owner            string           `gorm:"size:100" json:"owner"`
	TenantID         string           `gorm:"size:64" json:"tenant_id,omitempty"` // 预留；MVP 固定 platform_admin
	Status           string           `gorm:"size:20;not null" json:"status"`
	SourceType       SourceType       `gorm:"size:20;not null" json:"source_type"`
}

// GetResourceID returns the resource id.
func (r *ResourceBase) GetResourceID() string { return r.ResourceID }

// GetAppName returns the application name, empty when nil.
func (r *ResourceBase) GetAppName() string {
	if r.AppName == nil {
		return ""
	}
	return *r.AppName
}

// GetEnv returns the environment.
func (r *ResourceBase) GetEnv() string { return r.Env }

// GetCluster returns the cluster, empty when nil.
func (r *ResourceBase) GetCluster() string {
	if r.Cluster == nil {
		return ""
	}
	return *r.Cluster
}

// GetStatus returns the resource status.
func (r *ResourceBase) GetStatus() string { return r.Status }