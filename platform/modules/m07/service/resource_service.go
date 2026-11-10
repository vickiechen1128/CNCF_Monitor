// Package service contains M07 v3 use cases.
package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// DefaultTenantID is the MVP tenant.
const DefaultTenantID = "platform_admin"

// DictionaryResolver validates dictionary/domain references.
type DictionaryResolver interface {
	ValidateResource(ctx context.Context, resource *domain.Resource) error
	PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)
}

// ResourceService implements resource use cases.
type ResourceService struct {
	repo repository.ResourceRepository
	dict DictionaryResolver
}

// NewResourceService constructs a resource service.
func NewResourceService(repo repository.ResourceRepository, dict DictionaryResolver) *ResourceService {
	return &ResourceService{repo: repo, dict: dict}
}

// List returns a page of resources.
func (s *ResourceService) List(ctx context.Context, filter repository.ListFilter) ([]*domain.Resource, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one resource.
func (s *ResourceService) Get(ctx context.Context, resourceID string) (*domain.Resource, error) {
	return s.repo.Get(ctx, resourceID)
}

// Create creates a resource.
func (s *ResourceService) Create(ctx context.Context, resource *domain.Resource) (*domain.Resource, error) {
	if resource == nil {
		return nil, &domain.ValidationError{Field: "resource", Message: "is required"}
	}
	resource.Normalize()
	if resource.ResourceID == "" {
		id, err := domain.NewResourceID()
		if err != nil {
			return nil, err
		}
		resource.ResourceID = id
	}
	if resource.TenantID == "" {
		resource.TenantID = DefaultTenantID
	}
	if resource.SourceType == "" {
		resource.SourceType = domain.SourceManual
	}
	if resource.Status == "" {
		resource.Status = domain.StatusOnline
	}
	if err := s.resolvePlatform(ctx, resource); err != nil {
		return nil, err
	}
	if err := s.dict.ValidateResource(ctx, resource); err != nil {
		return nil, err
	}
	if err := resource.Validate(); err != nil {
		return nil, err
	}
	if err := resource.EnsureDedupKey(); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, resource); err != nil {
		return nil, err
	}
	return resource, nil
}

// Update replaces the mutable fields of an existing resource.
func (s *ResourceService) Update(ctx context.Context, resourceID string, input *domain.Resource) (*domain.Resource, error) {
	if input == nil {
		return nil, &domain.ValidationError{Field: "resource", Message: "is required"}
	}
	existing, err := s.repo.Get(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	if input.Category != "" && input.Category != existing.Category {
		return nil, &domain.ValidationError{Field: "resource_category", Message: "is immutable"}
	}

	updated := *input
	updated.ResourceID = existing.ResourceID
	updated.Category = existing.Category
	updated.TenantID = existing.TenantID
	updated.SourceType = existing.SourceType
	updated.CreatedAt = existing.CreatedAt
	updated.Normalize()
	if updated.Status == "" {
		updated.Status = existing.Status
	}
	if err := s.resolvePlatform(ctx, &updated); err != nil {
		return nil, err
	}
	if err := s.dict.ValidateResource(ctx, &updated); err != nil {
		return nil, err
	}
	if err := updated.Validate(); err != nil {
		return nil, err
	}
	if err := updated.EnsureDedupKey(); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, &updated); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, resourceID)
}

// Delete soft-deletes a resource.
func (s *ResourceService) Delete(ctx context.Context, resourceID string) error {
	if strings.TrimSpace(resourceID) == "" {
		return &domain.ValidationError{Field: "resource_id", Message: "is required"}
	}
	return s.repo.SoftDelete(ctx, resourceID)
}

func (s *ResourceService) resolvePlatform(ctx context.Context, resource *domain.Resource) error {
	if strings.TrimSpace(resource.PlatformCode) != "" || strings.TrimSpace(resource.AppCode) == "" {
		return nil
	}
	platform, ok, err := s.dict.PrimaryPlatformOfApp(ctx, resource.AppCode)
	if err != nil {
		return fmt.Errorf("resolve primary platform for %q: %w", resource.AppCode, err)
	}
	if ok {
		resource.PlatformCode = platform
	}
	return nil
}
