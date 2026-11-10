package dictionary

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// Resolver validates resource references and resolves platform fallback.
type Resolver interface {
	ValidateResource(ctx context.Context, resource *domain.Resource) error
	PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)
}

// Service wraps the dictionary repository with resource-oriented validation.
type Service struct {
	repo Repository
}

// NewService constructs a dictionary service.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// ValidateResource checks network domain and dictionary references.
func (s *Service) ValidateResource(ctx context.Context, resource *domain.Resource) error {
	if resource == nil {
		return &domain.ValidationError{Field: "resource", Message: "is required"}
	}

	ok, err := s.repo.NetworkDomainExists(ctx, resource.NetworkDomainID)
	if err != nil {
		return err
	}
	if !ok {
		return &domain.ValidationError{Field: "network_domain_id", Message: fmt.Sprintf("network domain %q does not exist", resource.NetworkDomainID)}
	}

	if resource.BizCode != "" {
		ok, err = s.repo.BusinessDomainEnabled(ctx, resource.BizCode)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{Field: "biz_code", Message: fmt.Sprintf("business domain %q is missing or disabled", resource.BizCode)}
		}
	}

	if resource.AppCode != "" {
		ok, err = s.repo.ApplicationEnabled(ctx, resource.AppCode)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{Field: "app_code", Message: fmt.Sprintf("application %q is missing or disabled", resource.AppCode)}
		}
	}

	if resource.PlatformCode != "" {
		ok, err = s.repo.PlatformEnabled(ctx, resource.PlatformCode)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{Field: "platform_code", Message: fmt.Sprintf("platform %q is missing or disabled", resource.PlatformCode)}
		}
		if resource.AppCode != "" {
			ok, err = s.repo.PlatformBelongsToApp(ctx, resource.AppCode, resource.PlatformCode)
			if err != nil {
				return err
			}
			if !ok {
				return &domain.ValidationError{
					Field:   "platform_code",
					Message: fmt.Sprintf("platform %q is not associated with application %q", resource.PlatformCode, resource.AppCode),
				}
			}
		}
	}
	return nil
}

// PrimaryPlatformOfApp returns the app's primary platform, if any.
func (s *Service) PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error) {
	return s.repo.PrimaryPlatformOfApp(ctx, appCode)
}

func (s *Service) ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error) {
	return s.repo.ListBusinessDomains(ctx)
}

func (s *Service) ListApplications(ctx context.Context) ([]Application, error) {
	return s.repo.ListApplications(ctx)
}

func (s *Service) ListPlatforms(ctx context.Context) ([]Platform, error) {
	return s.repo.ListPlatforms(ctx)
}

func (s *Service) ListClouds(ctx context.Context) ([]Cloud, error) {
	return s.repo.ListClouds(ctx)
}

func (s *Service) ListZoneTypes(ctx context.Context) ([]ZoneType, error) {
	return s.repo.ListZoneTypes(ctx)
}

func (s *Service) ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error) {
	return s.repo.ListAppPlatformRels(ctx, appCode, platformCode)
}

// CreateAppPlatformRel creates an app↔platform relation after validating both refs.
func (s *Service) CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error) {
	ok, err := s.repo.ApplicationEnabled(ctx, appCode)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &domain.ValidationError{Field: "app_code", Message: fmt.Sprintf("application %q is missing or disabled", appCode)}
	}
	ok, err = s.repo.PlatformEnabled(ctx, platformCode)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, &domain.ValidationError{Field: "platform_code", Message: fmt.Sprintf("platform %q is missing or disabled", platformCode)}
	}
	return s.repo.CreateAppPlatformRel(ctx, appCode, platformCode, isPrimary)
}

// SetPrimaryAppPlatformRel toggles the primary flag.
func (s *Service) SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error) {
	return s.repo.SetPrimaryAppPlatformRel(ctx, relID, isPrimary)
}

// DeleteAppPlatformRel removes an app↔platform relation.
func (s *Service) DeleteAppPlatformRel(ctx context.Context, relID string) error {
	return s.repo.DeleteAppPlatformRel(ctx, relID)
}

func (s *Service) ListOSOptions(ctx context.Context) ([]OSOption, error) {
	return s.repo.ListOSOptions(ctx)
}
