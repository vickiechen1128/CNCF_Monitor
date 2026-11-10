package domain

import (
	"strings"
	"time"
)

// Resource is the M07 resource aggregate.
type Resource struct {
	ResourceID      string
	Category        Category
	TenantID        string
	NetworkDomainID string
	BizCode         string
	AppCode         string
	PlatformCode    string
	Env             Environment
	Cluster         string
	Owner           string
	Status          Status
	SourceType      SourceType
	ScrapePort      int
	DedupKey        string
	Attributes      Attributes
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Validate checks common fields, category attributes and ownership rules.
func (r *Resource) Validate() error {
	if r == nil {
		return newValidationError("resource", "is required")
	}
	if strings.TrimSpace(r.ResourceID) == "" {
		return newValidationError("resource_id", "is required")
	}
	if !r.Category.Valid() {
		return newValidationError("resource_category", "invalid category %q", r.Category)
	}
	if strings.TrimSpace(r.TenantID) == "" {
		return newValidationError("tenant_id", "is required")
	}
	if strings.TrimSpace(r.NetworkDomainID) == "" {
		return newValidationError("network_domain_id", "is required")
	}
	if !r.Env.Valid() {
		return newValidationError("env", "must be OPS/PRD/UAT")
	}
	if !r.Status.Valid() {
		return newValidationError("status", "must be online/offline/maintenance")
	}
	if !r.SourceType.Valid() {
		return newValidationError("source_type", "must be manual/import/cmdb")
	}
	if r.ScrapePort < 0 || r.ScrapePort > 65535 {
		return newValidationError("scrape_port", "must be between 0 and 65535")
	}
	if err := ValidateCategoryAttributes(r.Category, r.Attributes); err != nil {
		return err
	}
	return r.validateOwnership()
}

func (r *Resource) validateOwnership() error {
	switch r.Category {
	case CategoryApplication, CategoryDatabase, CategoryMiddleware:
		if strings.TrimSpace(r.AppCode) == "" {
			return newValidationError("app_code", "is required for %s", r.Category)
		}
		if strings.TrimSpace(r.Cluster) == "" {
			return newValidationError("cluster", "is required for %s", r.Category)
		}
	case CategoryGenericTarget:
		if strings.TrimSpace(r.AppCode) == "" && strings.TrimSpace(r.BizCode) == "" {
			return newValidationError("app_code", "app_code or biz_code is required for generic_target")
		}
	case CategoryInterfaceService:
		if strings.TrimSpace(r.AppCode) == "" {
			return newValidationError("app_code", "is required for interface_service")
		}
		if strings.TrimSpace(r.BizCode) == "" {
			return newValidationError("biz_code", "is required for interface_service")
		}
	}
	return nil
}

// EnsureDedupKey computes and stores the canonical dedup key.
func (r *Resource) EnsureDedupKey() error {
	key, err := DedupKey(r)
	if err != nil {
		return err
	}
	r.DedupKey = key
	return nil
}

// Normalize trims common string fields. It does not mutate attributes.
func (r *Resource) Normalize() {
	r.ResourceID = strings.TrimSpace(r.ResourceID)
	r.TenantID = strings.TrimSpace(r.TenantID)
	r.NetworkDomainID = strings.TrimSpace(r.NetworkDomainID)
	r.BizCode = strings.TrimSpace(r.BizCode)
	r.AppCode = strings.TrimSpace(r.AppCode)
	r.PlatformCode = strings.TrimSpace(r.PlatformCode)
	r.Cluster = strings.TrimSpace(r.Cluster)
	r.Owner = strings.TrimSpace(r.Owner)
}
