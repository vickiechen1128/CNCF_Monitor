package models

import "time"

// Host represents a cloud host resource imported from the host Excel template.
//
// Field names follow the English column names defined in
// assets/templates/excel/host_template.md.
type Host struct {
	BaseModel
	CloudCode     string `gorm:"size:50" json:"cloud_code"`
	AppCode       string `gorm:"size:100" json:"app_code"`
	SubAppCode    string `gorm:"size:100" json:"sub_app_code"`
	EnvFlag       string `gorm:"size:20" json:"env_flag"`
	ServerID      string `gorm:"size:64;uniqueIndex:idx_host_server_id" json:"server_id"`
	InstanceName  string `gorm:"size:200;not null" json:"instance_name"`
	Status        string `gorm:"size:20;not null" json:"status"`
	Region        string `gorm:"size:50;not null" json:"region"`
	ZoneEnv       string `gorm:"size:20;not null" json:"zone_env"`
	InstanceSpec  string `gorm:"size:50;not null" json:"instance_spec"`
	VCPU          int    `json:"vcpu"`
	MemoryGB      int    `json:"memory_gb"`
	Image         string `gorm:"size:200;not null" json:"image"`
	SystemDiskGB  int    `json:"system_disk_gb"`
	DataDiskGB    int    `json:"data_disk_gb"`
	PublicIP      string `gorm:"size:50" json:"public_ip"`
	Bandwidth     int    `json:"bandwidth"`
	PrivateSubnet string `gorm:"size:50" json:"private_subnet"`
	PrivateIP     string `gorm:"size:50" json:"private_ip"`
	Purpose       string `gorm:"size:200" json:"purpose"`
	VPC           string `gorm:"size:100;not null" json:"vpc"`
	SecurityGroup string `gorm:"size:100;not null" json:"security_group"`
	ExpiredAt     *time.Time `json:"expired_at,omitempty"`
}

// GetResourceID returns the resource id. ServerID is preferred, falling back to InstanceName.
func (h *Host) GetResourceID() string {
	if h.ServerID != "" {
		return h.ServerID
	}
	return h.InstanceName
}

// GetResourceType returns the resource type.
func (h *Host) GetResourceType() ResourceType { return ResourceTypeHost }

// GetAppName returns the application name, mapped from AppCode.
func (h *Host) GetAppName() string { return h.AppCode }

// GetEnv returns the environment, mapped from EnvFlag.
func (h *Host) GetEnv() string { return h.EnvFlag }

// GetCluster returns the cluster, mapped from SubAppCode.
func (h *Host) GetCluster() string { return h.SubAppCode }

// GetStatus returns the resource status.
func (h *Host) GetStatus() string { return h.Status }

// Hostname returns the hostname, mapped from InstanceName.
func (h *Host) Hostname() string { return h.InstanceName }

// InstanceIP returns the management IP, mapped from PrivateIP.
func (h *Host) InstanceIP() string { return h.PrivateIP }

// OSType returns the operating system type, mapped from Image.
func (h *Host) OSType() string { return h.Image }
