package importer

import (
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// ImportRowError is a row-level parse/validation failure.
type ImportRowError struct {
	RowNumber int
	Field     string
	Value     string
	Reason    string
}

func (e *ImportRowError) Error() string {
	return fmt.Sprintf("row %d %s=%q: %s", e.RowNumber, e.Field, e.Value, e.Reason)
}

// ToDomain converts the row to a domain resource.
func (r Row) ToDomain() (*domain.Resource, error) {
	status, err := MapStatus(r.Status)
	if err != nil {
		return nil, &ImportRowError{RowNumber: r.RowNumber, Field: "status", Value: r.Status, Reason: err.Error()}
	}
	if r.ScrapePort < 0 {
		return nil, &ImportRowError{RowNumber: r.RowNumber, Field: "scrape_port", Value: r.PortRaw, Reason: "must be 0 or 1~65535"}
	}
	if r.Port < 0 {
		return nil, &ImportRowError{RowNumber: r.RowNumber, Field: "port", Value: r.PortRaw, Reason: "must be an integer"}
	}

	attrs, err := r.attributes()
	if err != nil {
		return nil, err
	}
	id, err := domain.NewResourceID()
	if err != nil {
		return nil, err
	}
	resource := &domain.Resource{
		ResourceID:      id,
		Category:        r.Category,
		TenantID:        "platform_admin",
		NetworkDomainID: strings.TrimSpace(r.NetworkDomain),
		BizCode:         strings.TrimSpace(r.BizCode),
		AppCode:         strings.TrimSpace(r.AppCode),
		PlatformCode:    strings.TrimSpace(r.PlatformCode),
		Env:             domain.Environment(strings.TrimSpace(r.Env)),
		Cluster:         strings.TrimSpace(r.Cluster),
		Owner:           strings.TrimSpace(r.Owner),
		Status:          status,
		SourceType:      domain.SourceImport,
		ScrapePort:      r.ScrapePort,
		Attributes:      attrs,
	}
	if resource.NetworkDomainID == "" {
		resource.NetworkDomainID = "default"
	}
	if err := resource.Validate(); err != nil {
		return nil, &ImportRowError{RowNumber: r.RowNumber, Field: fieldFromError(err), Value: "", Reason: err.Error()}
	}
	if err := resource.EnsureDedupKey(); err != nil {
		return nil, &ImportRowError{RowNumber: r.RowNumber, Field: "dedup_key", Value: "", Reason: err.Error()}
	}
	return resource, nil
}

func (r Row) attributes() (domain.Attributes, error) {
	switch r.Category {
	case domain.CategoryHost:
		hostname := strings.TrimSpace(r.Hostname)
		if hostname == "" {
			hostname = strings.TrimSpace(r.InstanceName)
		}
		activatedAt, err := parseOptionalTime(r.ActivatedAt)
		if err != nil {
			return nil, &ImportRowError{RowNumber: r.RowNumber, Field: "activated_at", Value: r.ActivatedAt, Reason: err.Error()}
		}
		return domain.HostAttributes{
			Hostname: hostname, InstanceIP: strings.TrimSpace(r.InstanceIP),
			OSType: strings.TrimSpace(r.OSType), ActivatedAt: activatedAt,
		}, nil
	case domain.CategoryDatabase:
		return domain.DatabaseAttributes{
			DatabaseType: strings.TrimSpace(r.DatabaseType),
			InstanceIP:   strings.TrimSpace(r.InstanceIP),
			Port:         r.Port,
			Version:      strings.TrimSpace(r.Version),
		}, nil
	case domain.CategoryMiddleware:
		return domain.MiddlewareAttributes{
			MiddlewareType: strings.TrimSpace(r.MiddlewareType),
			InstanceIP:     strings.TrimSpace(r.InstanceIP),
			Port:           r.Port,
			Version:        strings.TrimSpace(r.Version),
		}, nil
	case domain.CategoryApplication:
		goLiveAt, err := parseOptionalTime(r.GoLiveAt)
		if err != nil {
			return nil, &ImportRowError{RowNumber: r.RowNumber, Field: "go_live_at", Value: r.GoLiveAt, Reason: err.Error()}
		}
		return domain.ApplicationAttributes{
			ServiceName:      strings.TrimSpace(r.ServiceName),
			HealthCheckURL:   strings.TrimSpace(r.HealthCheckURL),
			Protocol:         strings.TrimSpace(r.Protocol),
			Endpoint:         strings.TrimSpace(r.Endpoint),
			Port:             r.Port,
			Owner1:           strings.TrimSpace(r.Owner1),
			Owner1Contact:    strings.TrimSpace(r.Owner1Contact),
			Owner2:           strings.TrimSpace(r.Owner2),
			Owner2Contact:    strings.TrimSpace(r.Owner2Contact),
			OpsPerson:        strings.TrimSpace(r.OpsPerson),
			OpsPersonContact: strings.TrimSpace(r.OpsPersonContact),
			GoLiveAt:         goLiveAt,
		}, nil
	case domain.CategoryGenericTarget:
		return domain.GenericTargetAttributes{
			TargetName:   strings.TrimSpace(r.TargetName),
			InstanceIP:   strings.TrimSpace(r.InstanceIP),
			Port:         r.Port,
			MetricsPath:  strings.TrimSpace(r.MetricsPath),
			Scheme:       strings.TrimSpace(r.Scheme),
			ExporterType: strings.TrimSpace(r.ExporterType),
		}, nil
	case domain.CategoryInterfaceService:
		return domain.InterfaceServiceAttributes{
			APIName: strings.TrimSpace(r.APIName),
			APIURL:  strings.TrimSpace(r.APIURL),
		}, nil
	default:
		return nil, &domain.UnsupportedCategoryError{Category: string(r.Category)}
	}
}

// MapStatus maps Excel status text to the domain enum.
func MapStatus(raw string) (domain.Status, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "运行中", "正常", "online", "active", "running", "up":
		return domain.StatusOnline, nil
	case "已停止", "停止", "offline", "stopped", "down", "关机":
		return domain.StatusOffline, nil
	case "维护中", "维修中", "maintenance", "maintaining":
		return domain.StatusMaintenance, nil
	default:
		return "", fmt.Errorf("unsupported status %q", raw)
	}
}

func parseOptionalTime(raw string) (*time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, value); err == nil {
			return &t, nil
		}
	}
	return nil, fmt.Errorf("must be RFC3339 or YYYY-MM-DD")
}

func fieldFromError(err error) string {
	if validation, ok := err.(*domain.ValidationError); ok && validation.Field != "" {
		return validation.Field
	}
	return ""
}
