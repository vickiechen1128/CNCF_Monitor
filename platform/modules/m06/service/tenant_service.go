// Package service implements M06 v3 business rules.
package service

import (
	"context"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
)

// TenantService implements tenant administrative operations.
type TenantService struct {
	repo repository.TenantRepository
}

// NewTenantService constructs a tenant service.
func NewTenantService(repo repository.TenantRepository) *TenantService {
	return &TenantService{repo: repo}
}

// List returns tenants matching the filters.
func (s *TenantService) List(ctx context.Context, filter repository.ListTenantsFilter) ([]*domain.Tenant, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one tenant.
func (s *TenantService) Get(ctx context.Context, id string) (*domain.Tenant, error) {
	if strings.TrimSpace(id) == "" {
		return nil, &domain.ValidationError{Field: "id", Message: "is required"}
	}
	return s.repo.Get(ctx, id)
}

// Update applies the mutable tenant fields.
//
// network_domain_ids, is_platform_admin and status stay read-only: domain
// authorization is written through network_domains.authorized_tenant_ids
// (D17), and tenant lifecycle changes are out of scope for the MVP.
func (s *TenantService) Update(ctx context.Context, id string, input domain.UpdateTenantInput) (*domain.Tenant, error) {
	if strings.TrimSpace(id) == "" {
		return nil, &domain.ValidationError{Field: "id", Message: "is required"}
	}
	if !input.HasChanges() {
		return nil, &domain.ValidationError{
			Field:   "body",
			Message: "at least one of name/multi_site_enabled is required",
		}
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if name == "" {
			return nil, &domain.ValidationError{Field: "name", Message: "must not be empty"}
		}
		if len([]rune(name)) > 100 {
			return nil, &domain.ValidationError{Field: "name", Message: "must be at most 100 characters"}
		}
		input.Name = &name
	}
	return s.repo.Update(ctx, id, input)
}

// Create is reserved for a later release (MVP only maintains platform_admin).
func (s *TenantService) Create(context.Context) error {
	return &domain.ForbiddenError{Message: "租户创建暂未开放，请联系平台管理员"}
}

// ChangeStatus is reserved for a later release (MVP does not expose lifecycle).
func (s *TenantService) ChangeStatus(context.Context, string) error {
	return &domain.ForbiddenError{Message: "租户状态变更暂未开放，请联系平台管理员"}
}
