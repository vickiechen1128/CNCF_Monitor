package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// HostAttributes is the host attributes payload.
type HostAttributes struct {
	Hostname    string     `json:"hostname"`
	InstanceIP  string     `json:"instance_ip"`
	OSType      string     `json:"os_type"`
	OSVersion   string     `json:"os_version,omitempty"`
	ActivatedAt *time.Time `json:"activated_at,omitempty"`
}

// ToDomain converts to the domain type.
func (a HostAttributes) ToDomain() domain.HostAttributes {
	return domain.HostAttributes{
		Hostname:    a.Hostname,
		InstanceIP:  a.InstanceIP,
		OSType:      a.OSType,
		OSVersion:   a.OSVersion,
		ActivatedAt: a.ActivatedAt,
	}
}

// DatabaseAttributes is the database attributes payload.
type DatabaseAttributes struct {
	DatabaseType        string `json:"database_type"`
	InstanceIP          string `json:"instance_ip"`
	Port                int    `json:"port"`
	Version             string `json:"version,omitempty"`
	ConnectionSecretRef string `json:"connection_secret_ref,omitempty"`
}

// ToDomain converts to the domain type.
func (a DatabaseAttributes) ToDomain() domain.DatabaseAttributes {
	return domain.DatabaseAttributes{
		DatabaseType:        a.DatabaseType,
		InstanceIP:          a.InstanceIP,
		Port:                a.Port,
		Version:             a.Version,
		ConnectionSecretRef: a.ConnectionSecretRef,
	}
}

// MiddlewareAttributes is the middleware attributes payload.
type MiddlewareAttributes struct {
	MiddlewareType      string `json:"middleware_type"`
	InstanceIP          string `json:"instance_ip"`
	Port                int    `json:"port"`
	Version             string `json:"version,omitempty"`
	ConnectionSecretRef string `json:"connection_secret_ref,omitempty"`
}

// ToDomain converts to the domain type.
func (a MiddlewareAttributes) ToDomain() domain.MiddlewareAttributes {
	return domain.MiddlewareAttributes{
		MiddlewareType:      a.MiddlewareType,
		InstanceIP:          a.InstanceIP,
		Port:                a.Port,
		Version:             a.Version,
		ConnectionSecretRef: a.ConnectionSecretRef,
	}
}

// ApplicationAttributes is the application attributes payload.
type ApplicationAttributes struct {
	ServiceName      string     `json:"service_name"`
	HealthCheckURL   string     `json:"health_check_url"`
	Protocol         string     `json:"protocol,omitempty"`
	Endpoint         string     `json:"endpoint,omitempty"`
	Port             int        `json:"port,omitempty"`
	Owner1           string     `json:"owner1,omitempty"`
	Owner1Contact    string     `json:"owner1_contact,omitempty"`
	Owner2           string     `json:"owner2,omitempty"`
	Owner2Contact    string     `json:"owner2_contact,omitempty"`
	OpsPerson        string     `json:"ops_person,omitempty"`
	OpsPersonContact string     `json:"ops_person_contact,omitempty"`
	GoLiveAt         *time.Time `json:"go_live_at,omitempty"`
}

// ToDomain converts to the domain type.
func (a ApplicationAttributes) ToDomain() domain.ApplicationAttributes {
	return domain.ApplicationAttributes{
		ServiceName:      a.ServiceName,
		HealthCheckURL:   a.HealthCheckURL,
		Protocol:         a.Protocol,
		Endpoint:         a.Endpoint,
		Port:             a.Port,
		Owner1:           a.Owner1,
		Owner1Contact:    a.Owner1Contact,
		Owner2:           a.Owner2,
		Owner2Contact:    a.Owner2Contact,
		OpsPerson:        a.OpsPerson,
		OpsPersonContact: a.OpsPersonContact,
		GoLiveAt:         a.GoLiveAt,
	}
}

// GenericTargetAttributes is the generic-target attributes payload.
type GenericTargetAttributes struct {
	TargetName   string `json:"target_name"`
	InstanceIP   string `json:"instance_ip"`
	Port         int    `json:"port,omitempty"`
	MetricsPath  string `json:"metrics_path,omitempty"`
	Scheme       string `json:"scheme,omitempty"`
	ExporterType string `json:"exporter_type,omitempty"`
}

// ToDomain converts to the domain type.
func (a GenericTargetAttributes) ToDomain() domain.GenericTargetAttributes {
	return domain.GenericTargetAttributes{
		TargetName:   a.TargetName,
		InstanceIP:   a.InstanceIP,
		Port:         a.Port,
		MetricsPath:  a.MetricsPath,
		Scheme:       a.Scheme,
		ExporterType: a.ExporterType,
	}
}

// InterfaceServiceAttributes is the interface-service attributes payload.
type InterfaceServiceAttributes struct {
	APIName string `json:"api_name"`
	APIURL  string `json:"api_url"`
}

// ToDomain converts to the domain type.
func (a InterfaceServiceAttributes) ToDomain() domain.InterfaceServiceAttributes {
	return domain.InterfaceServiceAttributes{
		APIName: a.APIName,
		APIURL:  a.APIURL,
	}
}
