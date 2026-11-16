package service

import (
	"context"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
)

// CloudDictService implements the "admin grows only" cloud dictionary rules
// (M06 FR-09 / D37): entries can be added and disabled, but never renamed,
// re-keyed or deleted.
type CloudDictService struct {
	repo repository.CloudDictRepository
}

// NewCloudDictService constructs the service.
func NewCloudDictService(repo repository.CloudDictRepository) *CloudDictService {
	return &CloudDictService{repo: repo}
}

// Create registers a new cloud dictionary entry.
func (s *CloudDictService) Create(ctx context.Context, input domain.CreateCloudDictInput) (*domain.CloudDict, error) {
	if err := input.Normalize(); err != nil {
		return nil, err
	}
	_, found, err := s.repo.Get(ctx, input.Code)
	if err != nil {
		return nil, err
	}
	if found {
		return nil, &domain.CloudDictExistsError{Code: input.Code}
	}
	return s.repo.Create(ctx, domain.CloudDict{
		Code:        input.Code,
		Name:        input.Name,
		Type:        input.Type,
		Carrier:     input.Carrier,
		Description: input.Description,
	})
}

// Disable turns an entry off. Disabling is idempotent; entries referenced by
// any network domain are rejected so registered data keeps resolving its cloud.
func (s *CloudDictService) Disable(ctx context.Context, code string) (*domain.CloudDict, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, &domain.ValidationError{Field: "cloud_code", Message: "is required"}
	}
	item, found, err := s.repo.Get(ctx, code)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, &domain.CloudDictNotFoundError{Code: code}
	}
	if !item.Enabled {
		return item, nil
	}
	refs, err := s.repo.CountNetworkDomains(ctx, code)
	if err != nil {
		return nil, err
	}
	if refs > 0 {
		return nil, &domain.CloudDictInUseError{Code: code, ReferenceCount: refs}
	}
	return s.repo.Disable(ctx, code)
}
