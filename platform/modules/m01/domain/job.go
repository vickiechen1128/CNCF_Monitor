package domain

import (
	"regexp"
	"strings"
)

var jobNamePattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_.-]*$`)

// ValidateJobName checks the Prometheus-compatible job name.
func ValidateJobName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return NewValidationError("job_name", "is required")
	}
	if len(name) > 100 {
		return NewValidationError("job_name", "must be at most 100 characters")
	}
	if !jobNamePattern.MatchString(name) {
		return NewValidationError("job_name", "must match ^[a-zA-Z_][a-zA-Z0-9_.-]*$")
	}
	return nil
}

// TargetFieldForCategory derives the blackbox target field from the resource
// category. Non-probe categories are rejected.
func TargetFieldForCategory(category ResourceCategory) (string, error) {
	switch category {
	case CategoryInterfaceService:
		return "api_url", nil
	case CategoryApplication:
		return "health_check_url", nil
	default:
		return "", NewValidationError("resource_category", "blackbox jobs only support interface_service or application")
	}
}

// JobParams are the scrape parameters after the inheritance chain is applied.
type JobParams struct {
	Interval    string
	Timeout     string
	MetricsPath string
	Scheme      Scheme
}

// ResolveJobParams applies Job → mapping → exporter → global defaults. An
// application (application_http) job must provide metrics_path explicitly.
func ResolveJobParams(input JobParams, mapping *Mapping, exporter *ExporterTemplate, category ResourceCategory) (JobParams, error) {
	out := input
	if out.Interval == "" && mapping != nil {
		out.Interval = mapping.ScrapeInterval
	}
	if out.Interval == "" {
		out.Interval = DefaultScrapeInterval
	}
	if out.Timeout == "" && mapping != nil {
		out.Timeout = mapping.ScrapeTimeout
	}
	if out.Timeout == "" {
		out.Timeout = DefaultScrapeTimeout
	}
	if out.MetricsPath == "" && mapping != nil {
		out.MetricsPath = mapping.MetricsPath
	}
	if out.MetricsPath == "" && exporter != nil {
		out.MetricsPath = exporter.MetricsPath
	}
	if out.MetricsPath == "" {
		out.MetricsPath = DefaultMetricsPath
	}
	if out.Scheme == "" && mapping != nil {
		out.Scheme = mapping.Scheme
	}
	if out.Scheme == "" && exporter != nil {
		out.Scheme = exporter.Scheme
	}
	if out.Scheme == "" {
		out.Scheme = SchemeHTTP
	}
	if category == CategoryApplication && strings.TrimSpace(input.MetricsPath) == "" {
		return out, NewValidationError("metrics_path", "application jobs must set metrics_path explicitly")
	}
	if err := ValidateScrapeTiming(out.Interval, out.Timeout); err != nil {
		return out, err
	}
	if err := ValidateMetricsPath(out.MetricsPath); err != nil {
		return out, err
	}
	if !out.Scheme.Valid() {
		return out, NewValidationError("scheme", "must be http or https")
	}
	return out, nil
}

// ComputeMappingOverrides returns the fields whose effective value differs from
// the mapping default (used by "sync mapping defaults").
func ComputeMappingOverrides(input, effective JobParams, mapping *Mapping) []MappingOverride {
	if mapping == nil {
		return []MappingOverride{}
	}
	out := make([]MappingOverride, 0, 4)
	if input.Interval != "" && input.Interval != mapping.ScrapeInterval {
		out = append(out, MappingOverride{Field: "scrape_interval", Value: effective.Interval})
	}
	if input.Timeout != "" && input.Timeout != mapping.ScrapeTimeout {
		out = append(out, MappingOverride{Field: "scrape_timeout", Value: effective.Timeout})
	}
	if input.MetricsPath != "" && input.MetricsPath != mapping.MetricsPath {
		out = append(out, MappingOverride{Field: "metrics_path", Value: effective.MetricsPath})
	}
	if input.Scheme != "" && input.Scheme != mapping.Scheme {
		out = append(out, MappingOverride{Field: "scheme", Value: string(effective.Scheme)})
	}
	return out
}

// ResolvePort applies the MVP port chain and returns the target port plus
// whether an address can be rendered.
func ResolvePort(ref ResourceRef, mappingPort, exporterPort int) int {
	switch ref.Category {
	case CategoryHost:
		if ref.ScrapePort > 0 {
			return ref.ScrapePort
		}
		if mappingPort > 0 {
			return mappingPort
		}
		if exporterPort > 0 {
			return exporterPort
		}
		return 9100
	case CategoryDatabase, CategoryMiddleware:
		if ref.ScrapePort > 0 {
			return ref.ScrapePort
		}
		if mappingPort > 0 {
			return mappingPort
		}
		return ref.Port
	case CategoryApplication:
		return ref.Port
	case CategoryGenericTarget:
		if ref.Port > 0 {
			return ref.Port
		}
		if strings.EqualFold(ref.Scheme, "https") {
			return 443
		}
		return 80
	default:
		return 0
	}
}
