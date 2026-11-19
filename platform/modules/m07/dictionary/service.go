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
	return s.validateResource(ctx, nil, resource)
}

// ValidateResourceUpdate validates only the reference fields that changed.
//
// M07 SRS v2.0 / FR-29: a resource may keep referencing a dictionary entry that
// was disabled after the resource was created. Editing unrelated fields (owner,
// status, labels...) must not be blocked by that historical reference. Only a
// newly selected / changed reference has to be enabled.
func (s *Service) ValidateResourceUpdate(ctx context.Context, before, after *domain.Resource) error {
	return s.validateResource(ctx, before, after)
}

func (s *Service) validateResource(ctx context.Context, before, after *domain.Resource) error {
	if after == nil {
		return &domain.ValidationError{Field: "resource", Message: "is required"}
	}

	domainChanged := before == nil || before.NetworkDomainID != after.NetworkDomainID
	if domainChanged {
		ok, err := s.repo.NetworkDomainUsable(ctx, after.NetworkDomainID)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{
				Field:   "network_domain_id",
				Message: fmt.Sprintf("网域 %q 未登记或已禁用，请先在平台管理登记/启用", after.NetworkDomainID),
			}
		}
	}

	bizChanged := before == nil || before.BizCode != after.BizCode
	if after.BizCode != "" && bizChanged {
		ok, err := s.repo.BusinessDomainEnabled(ctx, after.BizCode)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{Field: "biz_code", Message: fmt.Sprintf("business domain %q is missing or disabled", after.BizCode)}
		}
	}

	appChanged := before == nil || before.AppCode != after.AppCode
	if after.AppCode != "" && appChanged {
		ok, err := s.repo.ApplicationEnabled(ctx, after.AppCode)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{Field: "app_code", Message: fmt.Sprintf("application %q is missing or disabled", after.AppCode)}
		}
	}

	platformChanged := before == nil || before.PlatformCode != after.PlatformCode
	if after.PlatformCode != "" && (platformChanged || appChanged) {
		ok, err := s.repo.PlatformEnabled(ctx, after.PlatformCode)
		if err != nil {
			return err
		}
		if !ok {
			return &domain.ValidationError{Field: "platform_code", Message: fmt.Sprintf("platform %q is missing or disabled", after.PlatformCode)}
		}
		if after.AppCode != "" {
			ok, err = s.repo.PlatformBelongsToApp(ctx, after.AppCode, after.PlatformCode)
			if err != nil {
				return err
			}
			if !ok {
				return &domain.ValidationError{
					Field:   "platform_code",
					Message: fmt.Sprintf("platform %q is not associated with application %q", after.PlatformCode, after.AppCode),
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

// PlatformBelongsToApp reports whether an app↔platform relation exists.
func (s *Service) PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error) {
	return s.repo.PlatformBelongsToApp(ctx, appCode, platformCode)
}

// ValidateReferenceTarget checks that a bulk reassignment target is an enabled
// dictionary entry of the requested kind (M07 SRS v2.0 FR-28).
func (s *Service) ValidateReferenceTarget(ctx context.Context, field, code string) error {
	code = strings.TrimSpace(code)
	if code == "" {
		return &domain.ValidationError{Field: "target_code", Message: "is required"}
	}
	var (
		ok  bool
		err error
	)
	switch field {
	case "biz_code":
		ok, err = s.repo.BusinessDomainEnabled(ctx, code)
	case "app_code":
		ok, err = s.repo.ApplicationEnabled(ctx, code)
	case "platform_code":
		ok, err = s.repo.PlatformEnabled(ctx, code)
	default:
		return &domain.ValidationError{
			Field:   "field",
			Message: "must be biz_code/app_code/platform_code",
		}
	}
	if err != nil {
		return err
	}
	if !ok {
		return &domain.ValidationError{
			Field:   "target_code",
			Message: fmt.Sprintf("目标条目 %q 未登记或已停用，请选择启用中的条目", code),
		}
	}
	return nil
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
	return s.repo.UpdateBusinessDomain(ctx, code, name, description, enabled)
}

func (s *Service) ListApplications(ctx context.Context) ([]Application, error) {
	return s.repo.ListApplications(ctx)
}

// CreateApplication registers an application dictionary entry together with its
// platform ownership (D42). At least one platform is required: an application
// never exists without a platform, and the first platform becomes its primary
// platform.
func (s *Service) CreateApplication(ctx context.Context, appCode, appName, description string, platformCodes []string) (*Application, error) {
	appCode = strings.TrimSpace(appCode)
	appName = strings.TrimSpace(appName)
	if !models.ValidAppCode.MatchString(appCode) {
		return nil, &domain.ValidationError{Field: "app_code", Message: "must match ^[a-z0-9-]{1,64}$"}
	}
	if appName == "" {
		return nil, &domain.ValidationError{Field: "app_name", Message: "is required"}
	}
	codes, err := normalizePlatformCodes(platformCodes)
	if err != nil {
		return nil, err
	}
	for _, code := range codes {
		ok, err := s.repo.PlatformEnabled(ctx, code)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, &domain.ValidationError{
				Field:   "platform_codes",
				Message: fmt.Sprintf("platform %q is missing or disabled", code),
			}
		}
	}
	return s.repo.CreateApplication(ctx, appCode, appName, strings.TrimSpace(description), codes)
}

// normalizePlatformCodes trims, de-duplicates and requires a non-empty platform
// set (D42 I1: 应用必须归属至少一个平台).
func normalizePlatformCodes(raw []string) ([]string, error) {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		code := strings.TrimSpace(item)
		if code == "" {
			continue
		}
		if _, dup := seen[code]; dup {
			continue
		}
		seen[code] = struct{}{}
		out = append(out, code)
	}
	if len(out) == 0 {
		return nil, &domain.ValidationError{
			Field:   "platform_codes",
			Message: "应用必须归属至少一个平台，请选择所属平台（首个即主平台）",
		}
	}
	return out, nil
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

// --- dictionary lifecycle (M07 SRS v2.0 §5.7) -------------------------------

// RevokeBusinessDomain revokes a zero-reference business entry. Codes are never
// released: a revoked entry stays reserved so historical labels remain unique.
func (s *Service) RevokeBusinessDomain(ctx context.Context, code, operator string) (*BusinessDomain, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, &domain.ValidationError{Field: "code", Message: "is required"}
	}
	return s.repo.RevokeBusinessDomain(ctx, code, operator)
}

// RevokeApplication revokes a zero-reference application entry.
func (s *Service) RevokeApplication(ctx context.Context, appCode, operator string) (*Application, error) {
	appCode = strings.TrimSpace(appCode)
	if appCode == "" {
		return nil, &domain.ValidationError{Field: "app_code", Message: "is required"}
	}
	return s.repo.RevokeApplication(ctx, appCode, operator)
}

// RevokePlatform revokes a zero-reference platform entry.
func (s *Service) RevokePlatform(ctx context.Context, platformCode, operator string) (*Platform, error) {
	platformCode = strings.TrimSpace(platformCode)
	if platformCode == "" {
		return nil, &domain.ValidationError{Field: "platform_code", Message: "is required"}
	}
	return s.repo.RevokePlatform(ctx, platformCode, operator)
}

// MergeBusinessDomain folds source into target and returns the moved reference
// count. The source becomes a terminal alias; history is not rewritten.
func (s *Service) MergeBusinessDomain(ctx context.Context, source, target, operator string) (int64, error) {
	source, target, err := validateMergeCodes(source, target, "code")
	if err != nil {
		return 0, err
	}
	return s.repo.MergeBusinessDomain(ctx, source, target, operator)
}

// MergeApplication folds source into target, migrating resources and platform
// ownership in one transaction.
func (s *Service) MergeApplication(ctx context.Context, source, target, operator string) (int64, error) {
	source, target, err := validateMergeCodes(source, target, "app_code")
	if err != nil {
		return 0, err
	}
	return s.repo.MergeApplication(ctx, source, target, operator)
}

// MergePlatform folds source into target, migrating resources and application
// ownership in one transaction.
func (s *Service) MergePlatform(ctx context.Context, source, target, operator string) (int64, error) {
	source, target, err := validateMergeCodes(source, target, "platform_code")
	if err != nil {
		return 0, err
	}
	return s.repo.MergePlatform(ctx, source, target, operator)
}

// RevokeCloud revokes a zero-reference cloud dictionary entry. Codes are never
// released: a revoked entry stays reserved so historical labels remain unique.
func (s *Service) RevokeCloud(ctx context.Context, cloudCode, operator string) (*Cloud, error) {
	cloudCode = strings.TrimSpace(cloudCode)
	if cloudCode == "" {
		return nil, &domain.ValidationError{Field: "cloud_code", Message: "is required"}
	}
	return s.repo.RevokeCloud(ctx, cloudCode, operator)
}

// MergeCloud folds a cloud source into target, migrating network-domain cloud
// labels in one transaction.
func (s *Service) MergeCloud(ctx context.Context, source, target, operator string) (int64, error) {
	source, target, err := validateMergeCodes(source, target, "cloud_code")
	if err != nil {
		return 0, err
	}
	return s.repo.MergeCloud(ctx, source, target, operator)
}

func validateMergeCodes(source, target, field string) (string, string, error) {
	source = strings.TrimSpace(source)
	target = strings.TrimSpace(target)
	if source == "" || target == "" {
		return "", "", &domain.ValidationError{Field: field, Message: "source and target are required"}
	}
	if source == target {
		return "", "", fmt.Errorf("%w: 不能将 %q 合并到自身", ErrDictionaryMergeSelf, source)
	}
	return source, target, nil
}

// ListDictionaryAuditLogs returns the most recent lifecycle actions.
func (s *Service) ListDictionaryAuditLogs(ctx context.Context, dictionaryType, code string, limit int) ([]DictionaryAuditLog, error) {
	dictionaryType = strings.TrimSpace(dictionaryType)
	switch dictionaryType {
	case "", dictionaryTypeBusiness, dictionaryTypeApplication, dictionaryTypePlatform, dictionaryTypeCloud:
	default:
		return nil, &domain.ValidationError{
			Field:   "dictionary_type",
			Message: "must be business/application/platform/cloud",
		}
	}
	return s.repo.ListDictionaryAuditLogs(ctx, dictionaryType, strings.TrimSpace(code), limit)
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
