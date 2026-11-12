package dictionary

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
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

	ok, err := s.repo.NetworkDomainUsable(ctx, resource.NetworkDomainID)
	if err != nil {
		return err
	}
	if !ok {
		return &domain.ValidationError{
			Field:   "network_domain_id",
			Message: fmt.Sprintf("网域 %q 未登记或已禁用，请先在平台管理登记/启用", resource.NetworkDomainID),
		}
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

// CreateBusinessDomain registers a business dictionary entry (default enabled).
func (s *Service) CreateBusinessDomain(ctx context.Context, code, name, description string) (*BusinessDomain, error) {
	code = strings.TrimSpace(code)
	name = strings.TrimSpace(name)
	if !models.ValidBizCode.MatchString(code) {
		return nil, &domain.ValidationError{Field: "code", Message: "must match ^[a-z0-9-]{1,64}$"}
	}
	if name == "" {
		return nil, &domain.ValidationError{Field: "name", Message: "is required"}
	}
	return s.repo.CreateBusinessDomain(ctx, code, name, strings.TrimSpace(description))
}

// UpdateBusinessDomain applies a restricted edit (name/description/enabled).
func (s *Service) UpdateBusinessDomain(ctx context.Context, code string, name, description *string, enabled *bool) (*BusinessDomain, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, &domain.ValidationError{Field: "code", Message: "is required"}
	}
	if name != nil {
		trimmed := strings.TrimSpace(*name)
		if trimmed == "" {
			return nil, &domain.ValidationError{Field: "name", Message: "must not be empty"}
		}
		name = &trimmed
	}
	if description != nil {
		trimmed := strings.TrimSpace(*description)
		description = &trimmed
	}
	if code == models.InfraBizCode && enabled != nil && !*enabled {
		return nil, &domain.ValidationError{
			Field:   "enabled",
			Message: "infra is the fallback business group and cannot be disabled",
		}
	}
	return s.repo.UpdateBusinessDomain(ctx, code, name, description, enabled)
}

func (s *Service) ListApplications(ctx context.Context) ([]Application, error) {
	return s.repo.ListApplications(ctx)
}

// CreateApplication registers an application dictionary entry (default enabled).
func (s *Service) CreateApplication(ctx context.Context, appCode, appName, description string) (*Application, error) {
	appCode = strings.TrimSpace(appCode)
	appName = strings.TrimSpace(appName)
	if !models.ValidAppCode.MatchString(appCode) {
		return nil, &domain.ValidationError{Field: "app_code", Message: "must match ^[a-z0-9-]{1,64}$"}
	}
	if appName == "" {
		return nil, &domain.ValidationError{Field: "app_name", Message: "is required"}
	}
	return s.repo.CreateApplication(ctx, appCode, appName, strings.TrimSpace(description))
}

// UpdateApplication applies a restricted edit (app_name/description/status).
func (s *Service) UpdateApplication(ctx context.Context, appCode string, appName, description, status *string) (*Application, error) {
	appCode = strings.TrimSpace(appCode)
	if appCode == "" {
		return nil, &domain.ValidationError{Field: "app_code", Message: "is required"}
	}
	if appName != nil {
		trimmed := strings.TrimSpace(*appName)
		if trimmed == "" {
			return nil, &domain.ValidationError{Field: "app_name", Message: "must not be empty"}
		}
		appName = &trimmed
	}
	if description != nil {
		trimmed := strings.TrimSpace(*description)
		description = &trimmed
	}
	if status != nil {
		trimmed := strings.TrimSpace(*status)
		if trimmed != models.AppStatusEnabled && trimmed != models.AppStatusDisabled {
			return nil, &domain.ValidationError{Field: "status", Message: "must be enabled/disabled"}
		}
		status = &trimmed
	}
	return s.repo.UpdateApplication(ctx, appCode, appName, description, status)
}

func (s *Service) ListPlatforms(ctx context.Context) ([]Platform, error) {
	return s.repo.ListPlatforms(ctx)
}

// CreatePlatform registers a platform dictionary entry (default enabled).
func (s *Service) CreatePlatform(ctx context.Context, platformCode, platformName, description string) (*Platform, error) {
	platformCode = strings.TrimSpace(platformCode)
	platformName = strings.TrimSpace(platformName)
	if !models.ValidPlatformCode.MatchString(platformCode) {
		return nil, &domain.ValidationError{Field: "platform_code", Message: "must match ^[a-z0-9-]{1,64}$"}
	}
	if platformName == "" {
		return nil, &domain.ValidationError{Field: "platform_name", Message: "is required"}
	}
	return s.repo.CreatePlatform(ctx, platformCode, platformName, strings.TrimSpace(description))
}

// UpdatePlatform applies a restricted edit (platform_name/description/enabled).
func (s *Service) UpdatePlatform(ctx context.Context, platformCode string, platformName, description *string, enabled *bool) (*Platform, error) {
	platformCode = strings.TrimSpace(platformCode)
	if platformCode == "" {
		return nil, &domain.ValidationError{Field: "platform_code", Message: "is required"}
	}
	if platformName != nil {
		trimmed := strings.TrimSpace(*platformName)
		if trimmed == "" {
			return nil, &domain.ValidationError{Field: "platform_name", Message: "must not be empty"}
		}
		platformName = &trimmed
	}
	if description != nil {
		trimmed := strings.TrimSpace(*description)
		description = &trimmed
	}
	return s.repo.UpdatePlatform(ctx, platformCode, platformName, description, enabled)
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

// EnsureDeclarations applies declaration sheets before resource validation.
func (s *Service) EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error {
	return s.repo.EnsureDeclarations(ctx, biz, app, platform)
}
