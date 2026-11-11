package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
)

// NetworkDomainService implements M06 administrative network-domain rules.
type NetworkDomainService struct {
	domains    repository.NetworkDomainRepository
	dictionary repository.DictionaryRepository
	m07        references.M07Reader
	monitoring references.MonitoringRetirer
}

// NewNetworkDomainService constructs the service. Nil ports degrade safely.
func NewNetworkDomainService(
	domains repository.NetworkDomainRepository,
	dictionary repository.DictionaryRepository,
	m07 references.M07Reader,
	monitoring references.MonitoringRetirer,
) *NetworkDomainService {
	if monitoring == nil {
		monitoring = references.NoopMonitoring{}
	}
	return &NetworkDomainService{domains: domains, dictionary: dictionary, m07: m07, monitoring: monitoring}
}

// List returns network domains matching the filters.
func (s *NetworkDomainService) List(ctx context.Context, filter repository.ListNetworkDomainsFilter) ([]*domain.NetworkDomain, int64, error) {
	return s.domains.List(ctx, filter)
}

// Get returns one network domain.
func (s *NetworkDomainService) Get(ctx context.Context, id string) (*domain.NetworkDomain, error) {
	return s.domains.Get(ctx, id)
}

// Create registers a new edge network domain.
//
// Tenant ownership is always platform_admin; cloud_code/zone_type are
// immutable after creation. The authorized tenant list is the authoritative
// grant and the tenant cache is synchronized in the same transaction.
func (s *NetworkDomainService) Create(ctx context.Context, input domain.CreateNetworkDomainInput) (*domain.NetworkDomain, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return nil, &domain.ValidationError{Field: "name", Message: "is required"}
	}
	if len([]rune(name)) > 100 {
		return nil, &domain.ValidationError{Field: "name", Message: "must be at most 100 characters"}
	}
	if len([]rune(input.Description)) > 500 {
		return nil, &domain.ValidationError{Field: "description", Message: "must be at most 500 characters"}
	}
	domainType, err := domain.ParseDomainType(stringValue(input.DomainType))
	if err != nil {
		return nil, err
	}
	if domainType != nil && *domainType != domain.DomainTypeEdge {
		return nil, &domain.ValidationError{
			Field:   "domain_type",
			Message: "v3.0 only creates edge domains; collection domains are reserved",
		}
	}
	zoneType := strings.TrimSpace(input.ZoneType)
	if zoneType == "" {
		return nil, &domain.ValidationError{Field: "zone_type", Message: "is required"}
	}
	ok, err := s.dictionary.ZoneTypeExists(ctx, zoneType)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &domain.ValidationError{Field: "zone_type", Message: fmt.Sprintf("zone_type %q is not registered", zoneType)}
	}
	cloudCode := strings.TrimSpace(input.CloudCode)
	if cloudCode == "" {
		return nil, &domain.ValidationError{Field: "cloud_code", Message: "is required"}
	}
	ok, err = s.dictionary.CloudEnabled(ctx, cloudCode)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &domain.ValidationError{Field: "cloud_code", Message: fmt.Sprintf("cloud %q is not registered or disabled", cloudCode)}
	}
	tenantIDs, err := s.normalizeTenantIDs(ctx, input.AuthorizedTenantIDs)
	if err != nil {
		return nil, err
	}

	domainCode := strings.TrimSpace(input.DomainCode)
	if domainCode == "" {
		domainCode, err = domain.RandomDomainCode()
		if err != nil {
			return nil, err
		}
	}
	id, err := domain.GenerateDomainID(domain.ReadDeployCode(), domainCode)
	if err != nil {
		return nil, err
	}
	exists, err := s.domains.IDExistsIncludingDeleted(ctx, id)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, &domain.ConflictError{Message: fmt.Sprintf("network domain id %q already exists", id)}
	}
	duplicate, err := s.domains.NameExists(ctx, name, "")
	if err != nil {
		return nil, err
	}
	if duplicate {
		return nil, &domain.ConflictError{Message: fmt.Sprintf("network domain name %q already exists", name)}
	}

	item := &domain.NetworkDomain{
		ID:                  id,
		Name:                name,
		Description:         strings.TrimSpace(input.Description),
		DomainType:          domain.DomainTypeEdge,
		ZoneType:            zoneType,
		CloudCode:           cloudCode,
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: tenantIDs,
		Status:              domain.DomainStatusEnabled,
	}
	if err := s.domains.Create(ctx, item); err != nil {
		return nil, err
	}
	return s.domains.Get(ctx, id)
}

// Update applies the mutable administrative fields.
func (s *NetworkDomainService) Update(ctx context.Context, id string, input domain.UpdateNetworkDomainInput) (*domain.NetworkDomain, error) {
	if !input.HasChanges() {
		return nil, &domain.ValidationError{
			Field:   "body",
			Message: "at least one of name/description/zone_type/authorized_tenant_ids is required",
		}
	}
	if _, err := s.domains.Get(ctx, id); err != nil {
		return nil, err
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, &domain.ValidationError{Field: "name", Message: "must not be empty"}
		}
		if len([]rune(name)) > 100 {
			return nil, &domain.ValidationError{Field: "name", Message: "must be at most 100 characters"}
		}
		duplicate, err := s.domains.NameExists(ctx, name, id)
		if err != nil {
			return nil, err
		}
		if duplicate {
			return nil, &domain.ConflictError{Message: fmt.Sprintf("network domain name %q already exists", name)}
		}
		input.Name = &name
	}
	if input.Description != nil && len([]rune(*input.Description)) > 500 {
		return nil, &domain.ValidationError{Field: "description", Message: "must be at most 500 characters"}
	}
	if input.ZoneType != nil {
		zoneType := strings.TrimSpace(*input.ZoneType)
		if zoneType == "" {
			return nil, &domain.ValidationError{Field: "zone_type", Message: "must not be empty"}
		}
		ok, err := s.dictionary.ZoneTypeExists(ctx, zoneType)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, &domain.ValidationError{Field: "zone_type", Message: fmt.Sprintf("zone_type %q is not registered", zoneType)}
		}
		input.ZoneType = &zoneType
	}
	if input.AuthorizedTenantIDs != nil {
		tenantIDs, err := s.normalizeTenantIDs(ctx, *input.AuthorizedTenantIDs)
		if err != nil {
			return nil, err
		}
		input.AuthorizedTenantIDs = &tenantIDs
	}
	return s.domains.Update(ctx, id, input)
}

// UpdateStatus enables or disables a domain. Disabling returns the impact so
// the caller can show what stays attached; enabling returns nil impact.
func (s *NetworkDomainService) UpdateStatus(ctx context.Context, id string, rawStatus string) (*domain.Impact, error) {
	status, err := domain.ParseDomainStatus(rawStatus)
	if err != nil {
		return nil, err
	}
	if status == "" {
		return nil, &domain.ValidationError{Field: "status", Message: "is required"}
	}
	if _, err := s.domains.Get(ctx, id); err != nil {
		return nil, err
	}
	if status == domain.DomainStatusEnabled {
		return nil, s.domains.UpdateStatus(ctx, id, status)
	}
	impact, err := s.computeImpact(ctx, id)
	if err != nil {
		return nil, err
	}
	if err := s.domains.UpdateStatus(ctx, id, status); err != nil {
		return nil, err
	}
	return impact, nil
}

// Impact returns the current impact scope.
func (s *NetworkDomainService) Impact(ctx context.Context, id string) (*domain.Impact, error) {
	if _, err := s.domains.Get(ctx, id); err != nil {
		return nil, err
	}
	return s.computeImpact(ctx, id)
}

// Delete removes a domain when M07 has no references, then retires monitoring
// state through the M09/M11 port.
func (s *NetworkDomainService) Delete(ctx context.Context, id string) (*domain.Impact, error) {
	if _, err := s.domains.Get(ctx, id); err != nil {
		return nil, err
	}
	impact, err := s.computeImpact(ctx, id)
	if err != nil {
		return nil, err
	}
	if impact.ResourceCount > 0 {
		return nil, &domain.DomainInUseError{DomainID: id, Impact: impact}
	}
	if err := s.monitoring.RetireDomain(ctx, id); err != nil {
		return nil, fmt.Errorf("retire monitoring state for network domain %q: %w", id, err)
	}
	if err := s.domains.Delete(ctx, id); err != nil {
		return nil, err
	}
	return impact, nil
}

func (s *NetworkDomainService) computeImpact(ctx context.Context, id string) (*domain.Impact, error) {
	impact := &domain.Impact{
		SampleResources:     []domain.ResourceSummary{},
		MonitoringAvailable: s.monitoring.Available(),
	}
	if s.m07 != nil {
		count, err := s.m07.CountByDomain(ctx, id)
		if err != nil {
			return nil, err
		}
		samples, err := s.m07.SamplesByDomain(ctx, id, 5)
		if err != nil {
			return nil, err
		}
		impact.ResourceCount = count
		impact.SampleResources = samples
	}
	monitoring, err := s.monitoring.Impact(ctx, id)
	if err != nil {
		return nil, err
	}
	impact.ManagedEdgeAgentCount = monitoring.ManagedEdgeAgentCount
	impact.HasOnlineAgents = monitoring.HasOnlineAgents
	return impact, nil
}

func (s *NetworkDomainService) normalizeTenantIDs(ctx context.Context, raw []string) ([]string, error) {
	seen := make(map[string]struct{}, len(raw))
	tenantIDs := make([]string, 0, len(raw))
	for _, value := range raw {
		id := strings.TrimSpace(value)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		tenantIDs = append(tenantIDs, id)
	}
	if len(tenantIDs) == 0 {
		tenantIDs = []string{models.PlatformAdminTenantID}
	}
	for _, id := range tenantIDs {
		ok, err := s.dictionary.TenantActive(ctx, id)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, &domain.ValidationError{
				Field:   "authorized_tenant_ids",
				Message: fmt.Sprintf("tenant %q is missing or not active", id),
			}
		}
	}
	return tenantIDs, nil
}

func stringValue(value *domain.DomainType) string {
	if value == nil {
		return ""
	}
	return string(*value)
}
