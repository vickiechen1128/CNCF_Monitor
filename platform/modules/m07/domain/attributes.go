package domain

import (
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"
)

// Attributes is the category-specific part of a resource.
type Attributes interface {
	Category() Category
	Validate() error
}

// HostAttributes contains host-specific fields.
type HostAttributes struct {
	Hostname    string
	InstanceIP  string
	OSType      string
	OSVersion   string
	ActivatedAt *time.Time
}

func (HostAttributes) Category() Category { return CategoryHost }

func (a HostAttributes) Validate() error {
	if strings.TrimSpace(a.Hostname) == "" {
		return newValidationError("hostname", "is required")
	}
	if err := validateIPv4("instance_ip", a.InstanceIP); err != nil {
		return err
	}
	if strings.TrimSpace(a.OSType) == "" {
		return newValidationError("os_type", "is required")
	}
	return nil
}

// DatabaseAttributes contains database-specific fields.
type DatabaseAttributes struct {
	DatabaseType        string
	InstanceIP          string
	Port                int
	Version             string
	ConnectionSecretRef string
}

func (DatabaseAttributes) Category() Category { return CategoryDatabase }

func (a DatabaseAttributes) Validate() error {
	if strings.TrimSpace(a.DatabaseType) == "" {
		return newValidationError("database_type", "is required")
	}
	if err := validateIPv4("instance_ip", a.InstanceIP); err != nil {
		return err
	}
	if err := validatePort("port", a.Port, true); err != nil {
		return err
	}
	return nil
}

// MiddlewareAttributes contains middleware-specific fields.
type MiddlewareAttributes struct {
	MiddlewareType      string
	InstanceIP          string
	Port                int
	Version             string
	ConnectionSecretRef string
}

func (MiddlewareAttributes) Category() Category { return CategoryMiddleware }

func (a MiddlewareAttributes) Validate() error {
	if strings.TrimSpace(a.MiddlewareType) == "" {
		return newValidationError("middleware_type", "is required")
	}
	if err := validateIPv4("instance_ip", a.InstanceIP); err != nil {
		return err
	}
	if err := validatePort("port", a.Port, true); err != nil {
		return err
	}
	return nil
}

// ApplicationAttributes contains application-service fields.
type ApplicationAttributes struct {
	ServiceName      string
	HealthCheckURL   string
	Protocol         string
	Endpoint         string
	Port             int
	Owner1           string
	Owner1Contact    string
	Owner2           string
	Owner2Contact    string
	OpsPerson        string
	OpsPersonContact string
	GoLiveAt         *time.Time
}

func (ApplicationAttributes) Category() Category { return CategoryApplication }

func (a ApplicationAttributes) Validate() error {
	if strings.TrimSpace(a.ServiceName) == "" {
		return newValidationError("service_name", "is required")
	}
	if err := validateURL("health_check_url", a.HealthCheckURL, "http", "https", "tcp"); err != nil {
		return err
	}
	if a.Port != 0 {
		if err := validatePort("port", a.Port, false); err != nil {
			return err
		}
	}
	if a.Protocol != "" && !isOneOf(strings.ToLower(a.Protocol), "http", "https", "tcp") {
		return newValidationError("protocol", "must be http/https/tcp")
	}
	return nil
}

// GenericTargetAttributes contains generic-target fields.
type GenericTargetAttributes struct {
	TargetName   string
	InstanceIP   string
	Port         int
	MetricsPath  string
	Scheme       string
	ExporterType string
}

func (GenericTargetAttributes) Category() Category { return CategoryGenericTarget }

func (a GenericTargetAttributes) Validate() error {
	if strings.TrimSpace(a.TargetName) == "" {
		return newValidationError("target_name", "is required")
	}
	if strings.TrimSpace(a.InstanceIP) == "" {
		return newValidationError("instance_ip", "is required")
	}
	if a.Port != 0 {
		if err := validatePort("port", a.Port, false); err != nil {
			return err
		}
	}
	if a.Scheme != "" && !isOneOf(strings.ToLower(a.Scheme), "http", "https") {
		return newValidationError("scheme", "must be http/https")
	}
	return nil
}

// InterfaceServiceAttributes contains interface-service fields.
type InterfaceServiceAttributes struct {
	APIName string
	APIURL  string
}

func (InterfaceServiceAttributes) Category() Category { return CategoryInterfaceService }

func (a InterfaceServiceAttributes) Validate() error {
	if strings.TrimSpace(a.APIName) == "" {
		return newValidationError("api_name", "is required")
	}
	if err := validateURL("api_url", a.APIURL, "http", "https"); err != nil {
		return err
	}
	return nil
}

func validateIPv4(field, raw string) error {
	value := strings.TrimSpace(raw)
	if value == "" {
		return newValidationError(field, "is required")
	}
	ip := net.ParseIP(value)
	if ip == nil || ip.To4() == nil {
		return newValidationError(field, "must be an IPv4 address")
	}
	return nil
}

func validatePort(field string, port int, required bool) error {
	if port == 0 {
		if required {
			return newValidationError(field, "is required")
		}
		return nil
	}
	if port < 1 || port > 65535 {
		return newValidationError(field, "must be between 1 and 65535")
	}
	return nil
}

func validateURL(field, raw string, schemes ...string) error {
	value := strings.TrimSpace(raw)
	if value == "" {
		return newValidationError(field, "is required")
	}
	u, err := url.Parse(value)
	if err != nil {
		return newValidationError(field, "invalid URL: %v", err)
	}
	if !isOneOf(strings.ToLower(u.Scheme), schemes...) {
		return newValidationError(field, "unsupported scheme %q", u.Scheme)
	}
	if strings.TrimSpace(u.Host) == "" {
		return newValidationError(field, "URL host is required")
	}
	return nil
}

func isOneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

// ValidateCategoryAttributes checks that attributes match category and are valid.
func ValidateCategoryAttributes(category Category, attrs Attributes) error {
	if attrs == nil {
		return newValidationError("attributes", "is required for category %s", category)
	}
	if attrs.Category() != category {
		return newValidationError("attributes", "category mismatch: got %s, want %s", attrs.Category(), category)
	}
	if err := attrs.Validate(); err != nil {
		return fmt.Errorf("%s attributes: %w", category, err)
	}
	return nil
}
