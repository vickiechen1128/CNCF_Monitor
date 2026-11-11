package dto

import (
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// domainTypeLabel is the fixed, user-facing label for collection-node domains.
const domainTypeLabel = "采集节点域"

// ListNetworkDomainsResponse is the v3 pagination envelope for network domains.
type ListNetworkDomainsResponse struct {
	List     []NetworkDomainResponse `json:"list"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
}

// NetworkDomainResponse is the administrative network-domain representation.
// Runtime onboarding fields (channel/token/agent_type/remote_write_url/
// heartbeat) are intentionally absent from the M06 v3 contract.
type NetworkDomainResponse struct {
	ID                  string    `json:"id"`
	Name                string    `json:"name"`
	Description         string    `json:"description"`
	DomainType          string    `json:"domain_type"`
	DomainTypeLabel     string    `json:"domain_type_label"`
	ZoneType            string    `json:"zone_type"`
	CloudCode           string    `json:"cloud_code"`
	TenantID            string    `json:"tenant_id"`
	AuthorizedTenantIDs []string  `json:"authorized_tenant_ids"`
	Status              string    `json:"status"`
	CreatedAt           time.Time `json:"created_at"`
	UpdatedAt           time.Time `json:"updated_at"`
}

// CreateNetworkDomainRequest is the POST /network-domains body. tenant_id is
// never accepted (ownership is fixed to platform_admin); unknown/immutable
// fields are rejected by the strict JSON decoder.
type CreateNetworkDomainRequest struct {
	Name                string   `json:"name"`
	Description         string   `json:"description"`
	CloudCode           string   `json:"cloud_code"`
	ZoneType            string   `json:"zone_type"`
	DomainCode          string   `json:"domain_code"`
	DomainType          *string  `json:"domain_type"`
	AuthorizedTenantIDs []string `json:"authorized_tenant_ids"`
}

// ToDomain converts the request to the service input.
func (r CreateNetworkDomainRequest) ToDomain() (domain.CreateNetworkDomainInput, error) {
	input := domain.CreateNetworkDomainInput{
		Name:                r.Name,
		Description:         r.Description,
		CloudCode:           r.CloudCode,
		ZoneType:            r.ZoneType,
		DomainCode:          r.DomainCode,
		AuthorizedTenantIDs: r.AuthorizedTenantIDs,
	}
	if r.DomainType != nil {
		parsed, err := domain.ParseDomainType(strings.TrimSpace(*r.DomainType))
		if err != nil {
			return domain.CreateNetworkDomainInput{}, err
		}
		input.DomainType = parsed
	}
	return input, nil
}

// UpdateNetworkDomainRequest is the PUT /network-domains/:id body. Only these
// four fields are mutable; any other field (cloud_code/tenant_id/domain_type/
// id/status) makes the strict decoder fail with 400.
type UpdateNetworkDomainRequest struct {
	Name                *string   `json:"name"`
	Description         *string   `json:"description"`
	ZoneType            *string   `json:"zone_type"`
	AuthorizedTenantIDs *[]string `json:"authorized_tenant_ids"`
}

// ToDomain converts the request to the service input.
func (r UpdateNetworkDomainRequest) ToDomain() domain.UpdateNetworkDomainInput {
	return domain.UpdateNetworkDomainInput{
		Name:                r.Name,
		Description:         r.Description,
		ZoneType:            r.ZoneType,
		AuthorizedTenantIDs: r.AuthorizedTenantIDs,
	}
}

// UpdateNetworkDomainStatusRequest is the PATCH /network-domains/:id/status body.
type UpdateNetworkDomainStatusRequest struct {
	Status string `json:"status"`
}

// UpdateNetworkDomainStatusResponse reports the resulting status and, when the
// domain was disabled, the affected scope.
type UpdateNetworkDomainStatusResponse struct {
	ID     string          `json:"id"`
	Status string          `json:"status"`
	Impact *ImpactResponse `json:"impact,omitempty"`
}

// DeleteNetworkDomainResponse is the DELETE /network-domains/:id response.
// cascade_impact uses the same shape as impact (D19 port scope).
type DeleteNetworkDomainResponse struct {
	ID            string         `json:"id"`
	Deleted       bool           `json:"deleted"`
	Impact        ImpactResponse `json:"impact"`
	CascadeImpact ImpactResponse `json:"cascade_impact"`
}

// ImpactResponse describes what stays attached to a disabled/deleted domain.
type ImpactResponse struct {
	ResourceCount         int64            `json:"resource_count"`
	SampleResources       []SampleResource `json:"sample_resources"`
	ManagedEdgeAgentCount int64            `json:"managed_edge_agent_count"`
	HasOnlineAgents       bool             `json:"has_online_agents"`
	MonitoringAvailable   bool             `json:"monitoring_available"`
}

// SampleResource is a lightweight resource reference in the impact view.
type SampleResource struct {
	ResourceID       string `json:"resource_id"`
	ResourceCategory string `json:"resource_category"`
	Name             string `json:"name"`
}

// FromNetworkDomain converts a domain network domain to the v3 representation.
func FromNetworkDomain(item *domain.NetworkDomain) NetworkDomainResponse {
	tenantIDs := item.AuthorizedTenantIDs
	if tenantIDs == nil {
		tenantIDs = []string{}
	}
	return NetworkDomainResponse{
		ID:                  item.ID,
		Name:                item.Name,
		Description:         item.Description,
		DomainType:          string(item.DomainType),
		DomainTypeLabel:     domainTypeLabel,
		ZoneType:            item.ZoneType,
		CloudCode:           item.CloudCode,
		TenantID:            item.TenantID,
		AuthorizedTenantIDs: tenantIDs,
		Status:              string(item.Status),
		CreatedAt:           item.CreatedAt,
		UpdatedAt:           item.UpdatedAt,
	}
}

// FromImpact converts a domain impact to the v3 representation.
func FromImpact(impact *domain.Impact) ImpactResponse {
	if impact == nil {
		return ImpactResponse{SampleResources: []SampleResource{}}
	}
	samples := make([]SampleResource, 0, len(impact.SampleResources))
	for _, item := range impact.SampleResources {
		samples = append(samples, SampleResource{
			ResourceID:       item.ResourceID,
			ResourceCategory: item.ResourceCategory,
			Name:             item.Name,
		})
	}
	return ImpactResponse{
		ResourceCount:         impact.ResourceCount,
		SampleResources:       samples,
		ManagedEdgeAgentCount: impact.ManagedEdgeAgentCount,
		HasOnlineAgents:       impact.HasOnlineAgents,
		MonitoringAvailable:   impact.MonitoringAvailable,
	}
}
