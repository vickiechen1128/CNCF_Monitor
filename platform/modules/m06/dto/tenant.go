// Package dto contains the M06 v3 HTTP request/response types.
package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// ListTenantsResponse is the v3 pagination envelope for tenants.
type ListTenantsResponse struct {
	List     []TenantResponse `json:"list"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"page_size"`
}

// TenantResponse is the administrative tenant representation.
//
// network_domain_ids is a read-only projection of the authoritative
// network_domains.authorized_tenant_ids field (reconciled on boot).
type TenantResponse struct {
	ID               string    `json:"id"`
	Name             string    `json:"name"`
	NetworkDomainIDs []string  `json:"network_domain_ids"`
	MultiSiteEnabled bool      `json:"multi_site_enabled"`
	IsPlatformAdmin  bool      `json:"is_platform_admin"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// UpdateTenantRequest is the PUT /tenants/:id body. Only name and
// multi_site_enabled are mutable; unknown fields (including immutable ones)
// are rejected by the handler.
type UpdateTenantRequest struct {
	Name             *string `json:"name"`
	MultiSiteEnabled *bool   `json:"multi_site_enabled"`
}

// ToDomain converts the request to the service input.
func (r UpdateTenantRequest) ToDomain() domain.UpdateTenantInput {
	return domain.UpdateTenantInput{Name: r.Name, MultiSiteEnabled: r.MultiSiteEnabled}
}

// FromDomain converts a domain tenant to the v3 representation.
func FromDomain(t *domain.Tenant) TenantResponse {
	domains := t.NetworkDomainIDs
	if domains == nil {
		domains = []string{}
	}
	return TenantResponse{
		ID:               t.ID,
		Name:             t.Name,
		NetworkDomainIDs: domains,
		MultiSiteEnabled: t.MultiSiteEnabled,
		IsPlatformAdmin:  t.IsPlatformAdmin,
		Status:           string(t.Status),
		CreatedAt:        t.CreatedAt,
		UpdatedAt:        t.UpdatedAt,
	}
}
