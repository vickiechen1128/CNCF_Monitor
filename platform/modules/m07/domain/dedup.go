package domain

import (
	"fmt"
	"strings"
)

// DedupKey returns the canonical import/upsert identity key.
//
//	host                              = host|<domain>|<instance_ip>
//	database/middleware/generic_target = <category>|<domain>|<instance_ip>|<port>
//	application                       = application|<domain>|<service_name>|<health_check_url>
//	interface_service                 = interface_service|<domain>|<api_url>
func DedupKey(r *Resource) (string, error) {
	if r == nil {
		return "", newValidationError("resource", "is required")
	}
	if !r.Category.Valid() {
		return "", newValidationError("resource_category", "invalid category %q", r.Category)
	}
	domainID := strings.TrimSpace(r.NetworkDomainID)
	if domainID == "" {
		return "", newValidationError("network_domain_id", "is required for dedup key")
	}

	switch r.Category {
	case CategoryHost:
		a, ok := r.Attributes.(HostAttributes)
		if !ok {
			return "", newValidationError("attributes", "host attributes are required")
		}
		ip := strings.TrimSpace(a.InstanceIP)
		if ip == "" {
			return "", newValidationError("instance_ip", "is required for dedup key")
		}
		return fmt.Sprintf("host|%s|%s", domainID, ip), nil
	case CategoryDatabase:
		a, ok := r.Attributes.(DatabaseAttributes)
		if !ok {
			return "", newValidationError("attributes", "database attributes are required")
		}
		ip := strings.TrimSpace(a.InstanceIP)
		if ip == "" || a.Port == 0 {
			return "", newValidationError("instance_ip/port", "are required for dedup key")
		}
		return fmt.Sprintf("database|%s|%s|%d", domainID, ip, a.Port), nil
	case CategoryMiddleware:
		a, ok := r.Attributes.(MiddlewareAttributes)
		if !ok {
			return "", newValidationError("attributes", "middleware attributes are required")
		}
		ip := strings.TrimSpace(a.InstanceIP)
		if ip == "" || a.Port == 0 {
			return "", newValidationError("instance_ip/port", "are required for dedup key")
		}
		return fmt.Sprintf("middleware|%s|%s|%d", domainID, ip, a.Port), nil
	case CategoryApplication:
		a, ok := r.Attributes.(ApplicationAttributes)
		if !ok {
			return "", newValidationError("attributes", "application attributes are required")
		}
		service := strings.TrimSpace(a.ServiceName)
		healthURL := strings.TrimSpace(a.HealthCheckURL)
		if service == "" || healthURL == "" {
			return "", newValidationError("service_name/health_check_url", "are required for dedup key")
		}
		return fmt.Sprintf("application|%s|%s|%s", domainID, service, healthURL), nil
	case CategoryGenericTarget:
		a, ok := r.Attributes.(GenericTargetAttributes)
		if !ok {
			return "", newValidationError("attributes", "generic_target attributes are required")
		}
		ip := strings.TrimSpace(a.InstanceIP)
		if ip == "" || a.Port == 0 {
			return "", newValidationError("instance_ip/port", "are required for dedup key")
		}
		return fmt.Sprintf("generic_target|%s|%s|%d", domainID, ip, a.Port), nil
	case CategoryInterfaceService:
		a, ok := r.Attributes.(InterfaceServiceAttributes)
		if !ok {
			return "", newValidationError("attributes", "interface_service attributes are required")
		}
		apiURL := strings.TrimSpace(a.APIURL)
		if apiURL == "" {
			return "", newValidationError("api_url", "is required for dedup key")
		}
		return fmt.Sprintf("interface_service|%s|%s", domainID, apiURL), nil
	default:
		return "", &UnsupportedCategoryError{Category: string(r.Category)}
	}
}
