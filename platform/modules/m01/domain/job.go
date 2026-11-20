package domain

import (
	"net"
	"net/url"
	"regexp"
	"strconv"
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

// ResolveJobParams applies Job → collection template → exporter → global
// defaults. An application (application_http) job must provide metrics_path
// explicitly.
func ResolveJobParams(input JobParams, template *CollectionTemplate, exporter *ExporterTemplate, category ResourceCategory) (JobParams, error) {
	out := input
	if out.Interval == "" && template != nil {
		out.Interval = template.ScrapeInterval
	}
	if out.Interval == "" {
		out.Interval = DefaultScrapeInterval
	}
	if out.Timeout == "" && template != nil {
		out.Timeout = template.ScrapeTimeout
	}
	if out.Timeout == "" {
		out.Timeout = DefaultScrapeTimeout
	}
	if out.MetricsPath == "" && template != nil {
		out.MetricsPath = template.MetricsPath
	}
	if out.MetricsPath == "" && exporter != nil {
		out.MetricsPath = exporter.MetricsPath
	}
	if out.MetricsPath == "" {
		out.MetricsPath = DefaultMetricsPath
	}
	if out.Scheme == "" && template != nil {
		out.Scheme = template.Scheme
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

// ComputeTemplateOverrides returns the fields whose effective value differs from
// the template default (used by "sync template defaults").
func ComputeTemplateOverrides(input, effective JobParams, template *CollectionTemplate) []MappingOverride {
	if template == nil {
		return []MappingOverride{}
	}
	out := make([]MappingOverride, 0, 4)
	if input.Interval != "" && input.Interval != template.ScrapeInterval {
		out = append(out, MappingOverride{Field: "scrape_interval", Value: effective.Interval})
	}
	if input.Timeout != "" && input.Timeout != template.ScrapeTimeout {
		out = append(out, MappingOverride{Field: "scrape_timeout", Value: effective.Timeout})
	}
	if input.MetricsPath != "" && input.MetricsPath != template.MetricsPath {
		out = append(out, MappingOverride{Field: "metrics_path", Value: effective.MetricsPath})
	}
	if input.Scheme != "" && input.Scheme != template.Scheme {
		out = append(out, MappingOverride{Field: "scheme", Value: string(effective.Scheme)})
	}
	return out
}

// ResolvePort applies the MVP port chain and returns the target port plus
// whether an address can be rendered.
func ResolvePort(ref ResourceRef, templatePort, exporterPort int) int {
	switch ref.Category {
	case CategoryHost:
		if ref.ScrapePort > 0 {
			return ref.ScrapePort
		}
		if templatePort > 0 {
			return templatePort
		}
		if exporterPort > 0 {
			return exporterPort
		}
		return 9100
	case CategoryDatabase, CategoryMiddleware:
		if ref.ScrapePort > 0 {
			return ref.ScrapePort
		}
		if templatePort > 0 {
			return templatePort
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

// ResourceAddress renders the standard-scrape target address for a resource
// using the MVP port chain. It returns an empty string when no host exists.
func ResourceAddress(ref ResourceRef, mappingPort, exporterPort int) string {
	host := strings.TrimSpace(ref.InstanceIP)
	if host == "" && ref.Category == CategoryApplication {
		host = HostFromURL(ref.Endpoint)
		if host == "" {
			host = HostFromURL(ref.TargetURL)
		}
	}
	if host == "" {
		return ""
	}
	port := ResolvePort(ref, mappingPort, exporterPort)
	if port <= 0 {
		return host
	}
	return net.JoinHostPort(host, strconv.Itoa(port))
}

// HostFromURL extracts the hostname from a URL or host[:port] string.
func HostFromURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return parsed.Hostname()
}

// 端口来源枚举（与 M09 生成侧端口优先级口径对齐；额外补充 host 的
// 系统默认兜底 9100，避免把"默认端口"显示成未解析）。
const (
	PortSourceInstance   = "instance"
	PortSourceMapping    = "mapping"
	PortSourceTemplate   = "template"
	PortSourceBusiness   = "business"
	PortSourceDefault    = "default"
	PortSourceUnresolved = "unresolved"
)

// ResolvePortWithSource mirrors ResolvePort and additionally reports which layer
// produced the effective port, so the UI can tell the user where to change it.
func ResolvePortWithSource(ref ResourceRef, mappingPort, exporterPort int) (int, string) {
	switch ref.Category {
	case CategoryHost:
		if ref.ScrapePort > 0 {
			return ref.ScrapePort, PortSourceInstance
		}
		if mappingPort > 0 {
			return mappingPort, PortSourceMapping
		}
		if exporterPort > 0 {
			return exporterPort, PortSourceTemplate
		}
		return 9100, PortSourceDefault
	case CategoryDatabase, CategoryMiddleware:
		if ref.ScrapePort > 0 {
			return ref.ScrapePort, PortSourceInstance
		}
		if mappingPort > 0 {
			return mappingPort, PortSourceMapping
		}
		if ref.Port > 0 {
			return ref.Port, PortSourceBusiness
		}
		return 0, PortSourceUnresolved
	default:
		if ref.Port > 0 {
			return ref.Port, PortSourceDefault
		}
		return 0, PortSourceUnresolved
	}
}
