// Package dto contains v3 API request/response types for M07.
package dto

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// CreateResourceRequest is the v3 create request.
type CreateResourceRequest struct {
	ResourceCategory string          `json:"resource_category"`
	TenantID         string          `json:"tenant_id,omitempty"`
	NetworkDomainID  string          `json:"network_domain_id"`
	BizCode          string          `json:"biz_code,omitempty"`
	AppCode          string          `json:"app_code,omitempty"`
	PlatformCode     string          `json:"platform_code,omitempty"`
	Env              string          `json:"env"`
	Cluster          string          `json:"cluster,omitempty"`
	Owner            string          `json:"owner,omitempty"`
	Status           string          `json:"status,omitempty"`
	ScrapePort       int             `json:"scrape_port,omitempty"`
	Attributes       json.RawMessage `json:"attributes"`
}

// UpdateResourceRequest is the v3 full-replacement update request.
type UpdateResourceRequest struct {
	ResourceCategory string          `json:"resource_category,omitempty"`
	NetworkDomainID  string          `json:"network_domain_id"`
	BizCode          string          `json:"biz_code,omitempty"`
	AppCode          string          `json:"app_code,omitempty"`
	PlatformCode     string          `json:"platform_code,omitempty"`
	Env              string          `json:"env"`
	Cluster          string          `json:"cluster,omitempty"`
	Owner            string          `json:"owner,omitempty"`
	Status           string          `json:"status,omitempty"`
	ScrapePort       int             `json:"scrape_port,omitempty"`
	Attributes       json.RawMessage `json:"attributes"`
}

// ToDomain converts a create request to a domain resource.
func (r CreateResourceRequest) ToDomain() (*domain.Resource, error) {
	category, err := domain.ParseCategory(r.ResourceCategory)
	if err != nil {
		return nil, err
	}
	attrs, err := DecodeAttributes(category, r.Attributes)
	if err != nil {
		return nil, err
	}
	return &domain.Resource{
		Category:        category,
		TenantID:        r.TenantID,
		NetworkDomainID: r.NetworkDomainID,
		BizCode:         r.BizCode,
		AppCode:         r.AppCode,
		PlatformCode:    r.PlatformCode,
		Env:             domain.Environment(r.Env),
		Cluster:         r.Cluster,
		Owner:           r.Owner,
		Status:          domain.Status(r.Status),
		ScrapePort:      r.ScrapePort,
		Attributes:      attrs,
	}, nil
}

// ToDomain converts an update request to a domain resource.
func (r UpdateResourceRequest) ToDomain() (*domain.Resource, error) {
	category := domain.Category(r.ResourceCategory)
	if category != "" && !category.Valid() {
		return nil, fmt.Errorf("invalid resource_category %q", r.ResourceCategory)
	}
	if category == "" {
		return nil, fmt.Errorf("resource_category is required for update")
	}
	attrs, err := DecodeAttributes(category, r.Attributes)
	if err != nil {
		return nil, err
	}
	return &domain.Resource{
		Category:        category,
		NetworkDomainID: r.NetworkDomainID,
		BizCode:         r.BizCode,
		AppCode:         r.AppCode,
		PlatformCode:    r.PlatformCode,
		Env:             domain.Environment(r.Env),
		Cluster:         r.Cluster,
		Owner:           r.Owner,
		Status:          domain.Status(r.Status),
		ScrapePort:      r.ScrapePort,
		Attributes:      attrs,
	}, nil
}

// DecodeAttributes decodes the category-specific attributes payload.
func DecodeAttributes(category domain.Category, raw json.RawMessage) (domain.Attributes, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, fmt.Errorf("attributes is required")
	}
	switch category {
	case domain.CategoryHost:
		var a HostAttributes
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("decode host attributes: %w", err)
		}
		return a.ToDomain(), nil
	case domain.CategoryDatabase:
		var a DatabaseAttributes
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("decode database attributes: %w", err)
		}
		return a.ToDomain(), nil
	case domain.CategoryMiddleware:
		var a MiddlewareAttributes
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("decode middleware attributes: %w", err)
		}
		return a.ToDomain(), nil
	case domain.CategoryApplication:
		var a ApplicationAttributes
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("decode application attributes: %w", err)
		}
		return a.ToDomain(), nil
	case domain.CategoryGenericTarget:
		var a GenericTargetAttributes
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("decode generic_target attributes: %w", err)
		}
		return a.ToDomain(), nil
	case domain.CategoryInterfaceService:
		var a InterfaceServiceAttributes
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fmt.Errorf("decode interface_service attributes: %w", err)
		}
		return a.ToDomain(), nil
	default:
		return nil, &domain.UnsupportedCategoryError{Category: string(category)}
	}
}

// ListResponse is the v3 resource list response.
type ListResponse struct {
	List     []ResourceResponse `json:"list"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

// ResourceResponse is the v3 resource representation.
type ResourceResponse struct {
	ResourceID       string    `json:"resource_id"`
	ResourceCategory string    `json:"resource_category"`
	TenantID         string    `json:"tenant_id"`
	NetworkDomainID  string    `json:"network_domain_id"`
	BizCode          string    `json:"biz_code,omitempty"`
	AppCode          string    `json:"app_code,omitempty"`
	PlatformCode     string    `json:"platform_code,omitempty"`
	Env              string    `json:"env"`
	Cluster          string    `json:"cluster,omitempty"`
	Owner            string    `json:"owner,omitempty"`
	Status           string    `json:"status"`
	SourceType       string    `json:"source_type"`
	ScrapePort       int       `json:"scrape_port"`
	DedupKey         string    `json:"dedup_key,omitempty"`
	Attributes       any       `json:"attributes"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// FromDomain converts a domain resource to the v3 representation.
func FromDomain(r *domain.Resource) ResourceResponse {
	resp := ResourceResponse{
		ResourceID:       r.ResourceID,
		ResourceCategory: string(r.Category),
		TenantID:         r.TenantID,
		NetworkDomainID:  r.NetworkDomainID,
		BizCode:          r.BizCode,
		AppCode:          r.AppCode,
		PlatformCode:     r.PlatformCode,
		Env:              string(r.Env),
		Cluster:          r.Cluster,
		Owner:            r.Owner,
		Status:           string(r.Status),
		SourceType:       string(r.SourceType),
		ScrapePort:       r.ScrapePort,
		DedupKey:         r.DedupKey,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
	resp.Attributes = attributesToDTO(r.Attributes)
	return resp
}

func attributesToDTO(attrs domain.Attributes) any {
	switch a := attrs.(type) {
	case domain.HostAttributes:
		return HostAttributes{
			Hostname:    a.Hostname,
			InstanceIP:  a.InstanceIP,
			OSType:      a.OSType,
			OSVersion:   a.OSVersion,
			ActivatedAt: a.ActivatedAt,
		}
	case domain.DatabaseAttributes:
		return DatabaseAttributes{
			DatabaseType:        a.DatabaseType,
			InstanceIP:          a.InstanceIP,
			Port:                a.Port,
			Version:             a.Version,
			ConnectionSecretRef: a.ConnectionSecretRef,
		}
	case domain.MiddlewareAttributes:
		return MiddlewareAttributes{
			MiddlewareType:      a.MiddlewareType,
			InstanceIP:          a.InstanceIP,
			Port:                a.Port,
			Version:             a.Version,
			ConnectionSecretRef: a.ConnectionSecretRef,
		}
	case domain.ApplicationAttributes:
		return ApplicationAttributes{
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
	case domain.GenericTargetAttributes:
		return GenericTargetAttributes{
			TargetName:   a.TargetName,
			InstanceIP:   a.InstanceIP,
			Port:         a.Port,
			MetricsPath:  a.MetricsPath,
			Scheme:       a.Scheme,
			ExporterType: a.ExporterType,
		}
	case domain.InterfaceServiceAttributes:
		return InterfaceServiceAttributes{
			APIName: a.APIName,
			APIURL:  a.APIURL,
		}
	default:
		return nil
	}
}
