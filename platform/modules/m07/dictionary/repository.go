// Package dictionary provides read-only access to M07 reference dictionaries.
package dictionary

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"gorm.io/gorm"
)

var (
	ErrAppPlatformRelExists   = errors.New("app-platform relation already exists")
	ErrAppPlatformRelNotFound = errors.New("app-platform relation not found")
	ErrPrimaryPlatformExists  = errors.New("primary platform already exists")
	ErrDictionaryNotFound     = errors.New("dictionary entry not found")
	ErrDictionaryExists       = errors.New("dictionary entry already exists")
	// ErrDictionaryReferenced 表示条目仍被资源或应用平台关联引用，不能撤销。
	ErrDictionaryReferenced = errors.New("字典条目仍被引用，不能撤销")
	// ErrDictionaryTerminal 表示条目已合并或已撤销，处于终态。
	ErrDictionaryTerminal = errors.New("字典条目已处于终态（已合并/已撤销）")
	// ErrDictionaryMergeInvalid 表示合并源/目标不满足同类型、启用、非终态等约束。
	ErrDictionaryMergeInvalid = errors.New("字典合并条件不满足")
	// ErrDictionaryMergeSelf 表示合并源与目标相同。
	ErrDictionaryMergeSelf = errors.New("不能将字典条目合并到自身")
	// ErrAppRequiresPlatform 表示删除后应用将不再归属任何平台（D42 I1）。
	ErrAppRequiresPlatform = errors.New("应用必须归属至少一个平台，不允许解绑最后一个平台")
	// ErrPrimaryPlatformTransferRequired 表示试图直接取消 / 解绑主平台（D42 I3）。
	ErrPrimaryPlatformTransferRequired = errors.New("主平台须显式转移：请先将其他平台设为主平台，勿直接取消或解绑当前主平台")
)

// Dictionary statuses (M07 SRS v2.0 §3.4 / FR-24).
const (
	DictionaryStatusEnabled  = "enabled"
	DictionaryStatusDisabled = "disabled"
	DictionaryStatusMerged   = "merged"
	DictionaryStatusRevoked  = "revoked"
)

// Dictionary audit actions.
const (
	DictionaryActionEnable  = "enable"
	DictionaryActionDisable = "disable"
	DictionaryActionRevoke  = "revoke"
	DictionaryActionMerge   = "merge"
)

// BusinessDomain is a business dictionary entry.
type BusinessDomain struct {
	Code           string
	Name           string
	Description    string
	Enabled        bool
	Status         string
	ReferenceCount int64
	MergedInto     string
}

// Application is an application dictionary entry.
type Application struct {
	AppCode        string
	AppName        string
	Description    string
	Status         string
	ReferenceCount int64
	MergedInto     string
}

// Platform is a platform dictionary entry.
type Platform struct {
	PlatformCode   string
	PlatformName   string
	Description    string
	Enabled        bool
	Status         string
	ReferenceCount int64
	MergedInto     string
}

// DictionaryAuditLog is one lifecycle action on a dictionary entry.
type DictionaryAuditLog struct {
	ID             string
	DictionaryType string
	Action         string
	SourceCode     string
	TargetCode     string
	ReferenceCount int64
	Operator       string
	Detail         string
	CreatedAt      time.Time
}

// Cloud is a cloud dictionary entry. Create/disable writes live in M06
// (D37); M07 additionally exposes the terminal lifecycle states (revoke/merge)
// via the v3 dictionary API (M07 SRS v2.0 §5.7).
type Cloud struct {
	CloudCode      string
	CloudName      string
	CloudType      string
	Carrier        string
	Description    string
	Enabled        bool
	Status         string
	ReferenceCount int64
	MergedInto     string
}

// AppPlatformRel is an application↔platform relation.
type AppPlatformRel struct {
	RelID        string
	AppCode      string
	PlatformCode string
	IsPrimary    bool
}

// OSOption is a read-only OS dictionary entry.
type OSOption struct {
	Name   string
	Family string
}

// Repository exposes dictionary reads used by resource validation and API v3.
type Repository interface {
	BusinessDomainEnabled(ctx context.Context, code string) (bool, error)
	ApplicationEnabled(ctx context.Context, code string) (bool, error)
	PlatformEnabled(ctx context.Context, code string) (bool, error)
	NetworkDomainUsable(ctx context.Context, id string) (bool, error)
	PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error)
	PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)

	ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error)
	ListApplications(ctx context.Context) ([]Application, error)
	ListPlatforms(ctx context.Context) ([]Platform, error)
	CreateBusinessDomain(ctx context.Context, code, name, description string) (*BusinessDomain, error)
	UpdateBusinessDomain(ctx context.Context, code string, name, description *string, enabled *bool) (*BusinessDomain, error)
	CreateApplication(ctx context.Context, appCode, appName, description string, platformCodes []string) (*Application, error)
	UpdateApplication(ctx context.Context, appCode string, appName, description, status *string) (*Application, error)
	CreatePlatform(ctx context.Context, platformCode, platformName, description string) (*Platform, error)
	UpdatePlatform(ctx context.Context, platformCode string, platformName, description *string, enabled *bool) (*Platform, error)
	ListClouds(ctx context.Context) ([]Cloud, error)
	ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error)
	CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error)
	SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error)
	DeleteAppPlatformRel(ctx context.Context, relID string) error
	ListOSOptions(ctx context.Context) ([]OSOption, error)
	EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error

	CountBusinessDomainReferences(ctx context.Context, code string) (int64, error)
	CountApplicationReferences(ctx context.Context, code string) (int64, error)
	CountPlatformReferences(ctx context.Context, code string) (int64, error)
	CountCloudReferences(ctx context.Context, cloudCode string) (int64, error)
	RevokeBusinessDomain(ctx context.Context, code, operator string) (*BusinessDomain, error)
	RevokeApplication(ctx context.Context, appCode, operator string) (*Application, error)
	RevokePlatform(ctx context.Context, platformCode, operator string) (*Platform, error)
	RevokeCloud(ctx context.Context, cloudCode, operator string) (*Cloud, error)
	MergeBusinessDomain(ctx context.Context, source, target, operator string) (int64, error)
	MergeApplication(ctx context.Context, source, target, operator string) (int64, error)
	MergePlatform(ctx context.Context, source, target, operator string) (int64, error)
	MergeCloud(ctx context.Context, source, target, operator string) (int64, error)
	ListDictionaryAuditLogs(ctx context.Context, dictionaryType, code string, limit int) ([]DictionaryAuditLog, error)
}

// GORMRepository is the GORM-backed dictionary repository.
type GORMRepository struct {
	db *gorm.DB
}

// NewGORMRepository constructs a dictionary repository.
func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}

func (r *GORMRepository) BusinessDomainEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&businessDomainRecord{}).
		Where("code = ? AND enabled = ? AND merged_into IS NULL AND revoked_at IS NULL", code, true).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check business domain %q: %w", code, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) ApplicationEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&applicationDictRecord{}).
		Where("app_code = ? AND status = ? AND merged_into IS NULL AND revoked_at IS NULL", code, "enabled").
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check application %q: %w", code, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) PlatformEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&platformDictRecord{}).
		Where("platform_code = ? AND enabled = ? AND merged_into IS NULL AND revoked_at IS NULL", code, true).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check platform %q: %w", code, err)
	}
	return count > 0, nil
}

// NetworkDomainUsable reports whether the domain exists, is administratively
// enabled and is a collection-node domain (edge/collection). The v3.0 model
// no longer allows resources to be attached to a center-direct domain.
func (r *GORMRepository) NetworkDomainUsable(ctx context.Context, id string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&networkDomainRecord{}).
		Where("id = ? AND status = ? AND domain_type IN ?", id, "enabled", []string{"edge", "collection"}).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check network domain %q: %w", id, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&appPlatformRelRecord{}).
		Where("app_code = ? AND platform_code = ?", appCode, platformCode).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check app-platform relation %q/%q: %w", appCode, platformCode, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error) {
	var rel appPlatformRelRecord
	err := r.db.WithContext(ctx).
		Where("app_code = ? AND is_primary = ?", appCode, true).
		First(&rel).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("find primary platform for %q: %w", appCode, err)
	}
	return rel.PlatformCode, true, nil
}

func (r *GORMRepository) ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error) {
	var rows []businessDomainRecord
	if err := r.db.WithContext(ctx).Order("code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list business domains: %w", err)
	}
	counts, err := r.businessDomainReferenceCounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]BusinessDomain, 0, len(rows))
	for _, row := range rows {
		out = append(out, BusinessDomain{
			Code:           row.Code,
			Name:           row.Name,
			Description:    derefString(row.Description),
			Enabled:        row.Enabled,
			Status:         dictionaryStatus(row.Enabled, row.MergedInto, row.RevokedAt),
			ReferenceCount: counts[row.Code],
			MergedInto:     derefString(row.MergedInto),
		})
	}
	return out, nil
}

func (r *GORMRepository) ListApplications(ctx context.Context) ([]Application, error) {
	var rows []applicationDictRecord
	if err := r.db.WithContext(ctx).Order("app_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	counts, err := r.applicationReferenceCounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Application, 0, len(rows))
	for _, row := range rows {
		out = append(out, Application{
			AppCode:        row.AppCode,
			AppName:        row.AppName,
			Description:    derefString(row.Description),
			Status:         dictionaryStatus(row.Status == "enabled", row.MergedInto, row.RevokedAt),
			ReferenceCount: counts[row.AppCode],
			MergedInto:     derefString(row.MergedInto),
		})
	}
	return out, nil
}

func (r *GORMRepository) ListPlatforms(ctx context.Context) ([]Platform, error) {
	var rows []platformDictRecord
	if err := r.db.WithContext(ctx).Order("platform_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list platforms: %w", err)
	}
	counts, err := r.platformReferenceCounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Platform, 0, len(rows))
	for _, row := range rows {
		out = append(out, Platform{
			PlatformCode:   row.PlatformCode,
			PlatformName:   row.PlatformName,
			Description:    derefString(row.Description),
			Enabled:        row.Enabled,
			Status:         dictionaryStatus(row.Enabled, row.MergedInto, row.RevokedAt),
			ReferenceCount: counts[row.PlatformCode],
			MergedInto:     derefString(row.MergedInto),
		})
	}
	return out, nil
}

func (r *GORMRepository) CreateBusinessDomain(ctx context.Context, code, name, description string) (*BusinessDomain, error) {
	if err := r.ensureAbsent(ctx, &businessDomainRecord{}, "code", code); err != nil {
		return nil, err
	}
	row := &businessDomainRecord{Code: code, Name: name, Description: optionalString(description), Enabled: true}
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, fmt.Errorf("create business domain %q: %w", code, err)
	}
	return &BusinessDomain{
		Code: row.Code, Name: row.Name, Description: derefString(row.Description), Enabled: row.Enabled,
		Status: DictionaryStatusEnabled,
	}, nil
}

func (r *GORMRepository) UpdateBusinessDomain(ctx context.Context, code string, name, description *string, enabled *bool) (*BusinessDomain, error) {
	var row businessDomainRecord
	if err := r.db.WithContext(ctx).Where("code = ?", code).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load business domain %q: %w", code, err)
	}
	if row.RevokedAt != nil || row.MergedInto != nil {
		return nil, fmt.Errorf("%w: 业务分组 %q 已合并或已撤销，不能编辑", ErrDictionaryTerminal, code)
	}
	updates := map[string]any{}
	if name != nil {
		updates["name"] = *name
	}
	if description != nil {
		updates["description"] = optionalString(*description)
	}
	if enabled != nil {
		updates["enabled"] = *enabled
	}
	if len(updates) > 0 {
		if err := r.db.WithContext(ctx).Model(&row).Updates(updates).Error; err != nil {
			return nil, fmt.Errorf("update business domain %q: %w", code, err)
		}
	}
	if err := r.db.WithContext(ctx).Where("code = ?", code).First(&row).Error; err != nil {
		return nil, fmt.Errorf("reload business domain %q: %w", code, err)
	}
	count, err := r.CountBusinessDomainReferences(ctx, code)
	if err != nil {
		return nil, err
	}
	return &BusinessDomain{
		Code: row.Code, Name: row.Name, Description: derefString(row.Description), Enabled: row.Enabled,
		Status: dictionaryStatus(row.Enabled, row.MergedInto, row.RevokedAt), ReferenceCount: count,
		MergedInto: derefString(row.MergedInto),
	}, nil
}

// CreateApplication registers an application together with its platform
// ownership in a single transaction (D42): an application never exists without
// at least one platform, and the first platform becomes its primary platform.
func (r *GORMRepository) CreateApplication(ctx context.Context, appCode, appName, description string, platformCodes []string) (*Application, error) {
	if err := r.ensureAbsent(ctx, &applicationDictRecord{}, "app_code", appCode); err != nil {
		return nil, err
	}
	var out *Application
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := &applicationDictRecord{
			AppCode: appCode, AppName: appName, Description: optionalString(description), Status: "enabled",
		}
		if err := tx.Create(row).Error; err != nil {
			return fmt.Errorf("create application %q: %w", appCode, err)
		}
		for i, code := range platformCodes {
			// The first relation is forced primary by createAppPlatformRelTx.
			if _, err := createAppPlatformRelTx(tx, appCode, code, i == 0); err != nil {
				return err
			}
		}
		out = &Application{
			AppCode: row.AppCode, AppName: row.AppName, Description: derefString(row.Description),
			Status: DictionaryStatusEnabled,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *GORMRepository) UpdateApplication(ctx context.Context, appCode string, appName, description, status *string) (*Application, error) {
	var row applicationDictRecord
	if err := r.db.WithContext(ctx).Where("app_code = ?", appCode).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load application %q: %w", appCode, err)
	}
	if row.RevokedAt != nil || row.MergedInto != nil {
		return nil, fmt.Errorf("%w: 应用 %q 已合并或已撤销，不能编辑", ErrDictionaryTerminal, appCode)
	}
	updates := map[string]any{}
	if appName != nil {
		updates["app_name"] = *appName
	}
	if description != nil {
		updates["description"] = optionalString(*description)
	}
	if status != nil {
		updates["status"] = *status
	}
	if len(updates) > 0 {
		if err := r.db.WithContext(ctx).Model(&row).Updates(updates).Error; err != nil {
			return nil, fmt.Errorf("update application %q: %w", appCode, err)
		}
	}
	if err := r.db.WithContext(ctx).Where("app_code = ?", appCode).First(&row).Error; err != nil {
		return nil, fmt.Errorf("reload application %q: %w", appCode, err)
	}
	count, err := r.CountApplicationReferences(ctx, appCode)
	if err != nil {
		return nil, err
	}
	return &Application{
		AppCode: row.AppCode, AppName: row.AppName, Description: derefString(row.Description),
		Status:         dictionaryStatus(row.Status == "enabled", row.MergedInto, row.RevokedAt),
		ReferenceCount: count, MergedInto: derefString(row.MergedInto),
	}, nil
}

func (r *GORMRepository) CreatePlatform(ctx context.Context, platformCode, platformName, description string) (*Platform, error) {
	if err := r.ensureAbsent(ctx, &platformDictRecord{}, "platform_code", platformCode); err != nil {
		return nil, err
	}
	row := &platformDictRecord{
		PlatformCode: platformCode, PlatformName: platformName,
		Description: optionalString(description), Enabled: true,
	}
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		return nil, fmt.Errorf("create platform %q: %w", platformCode, err)
	}
	return &Platform{
		PlatformCode: row.PlatformCode, PlatformName: row.PlatformName,
		Description: derefString(row.Description), Enabled: row.Enabled,
		Status: DictionaryStatusEnabled,
	}, nil
}

func (r *GORMRepository) UpdatePlatform(ctx context.Context, platformCode string, platformName, description *string, enabled *bool) (*Platform, error) {
	var row platformDictRecord
	if err := r.db.WithContext(ctx).Where("platform_code = ?", platformCode).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load platform %q: %w", platformCode, err)
	}
	if row.RevokedAt != nil || row.MergedInto != nil {
		return nil, fmt.Errorf("%w: 平台 %q 已合并或已撤销，不能编辑", ErrDictionaryTerminal, platformCode)
	}
	updates := map[string]any{}
	if platformName != nil {
		updates["platform_name"] = *platformName
	}
	if description != nil {
		updates["description"] = optionalString(*description)
	}
	if enabled != nil {
		updates["enabled"] = *enabled
	}
	if len(updates) > 0 {
		if err := r.db.WithContext(ctx).Model(&row).Updates(updates).Error; err != nil {
			return nil, fmt.Errorf("update platform %q: %w", platformCode, err)
		}
	}
	if err := r.db.WithContext(ctx).Where("platform_code = ?", platformCode).First(&row).Error; err != nil {
		return nil, fmt.Errorf("reload platform %q: %w", platformCode, err)
	}
	count, err := r.CountPlatformReferences(ctx, platformCode)
	if err != nil {
		return nil, err
	}
	return &Platform{
		PlatformCode: row.PlatformCode, PlatformName: row.PlatformName,
		Description: derefString(row.Description), Enabled: row.Enabled,
		Status:         dictionaryStatus(row.Enabled, row.MergedInto, row.RevokedAt),
		ReferenceCount: count, MergedInto: derefString(row.MergedInto),
	}, nil
}

// ensureAbsent returns ErrDictionaryExists when the dictionary key already exists.
func (r *GORMRepository) ensureAbsent(ctx context.Context, model any, column, value string) error {
	var count int64
	if err := r.db.WithContext(ctx).Model(model).Where(column+" = ?", value).Count(&count).Error; err != nil {
		return fmt.Errorf("check %s %q: %w", column, value, err)
	}
	if count > 0 {
		return ErrDictionaryExists
	}
	return nil
}

func optionalString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (r *GORMRepository) ListClouds(ctx context.Context) ([]Cloud, error) {
	var rows []cloudDictRecord
	if err := r.db.WithContext(ctx).Order("cloud_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list clouds: %w", err)
	}
	counts, err := r.cloudReferenceCounts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]Cloud, 0, len(rows))
	for _, row := range rows {
		out = append(out, Cloud{
			CloudCode:      row.CloudCode,
			CloudName:      row.CloudName,
			CloudType:      row.CloudType,
			Carrier:        row.Carrier,
			Description:    derefString(row.Description),
			Enabled:        row.Enabled,
			Status:         dictionaryStatus(row.Enabled, row.MergedInto, row.RevokedAt),
			ReferenceCount: counts[row.CloudCode],
			MergedInto:     derefString(row.MergedInto),
		})
	}
	return out, nil
}

func (r *GORMRepository) ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error) {
	q := r.db.WithContext(ctx).Model(&appPlatformRelRecord{})
	if appCode != "" {
		q = q.Where("app_code = ?", appCode)
	}
	if platformCode != "" {
		q = q.Where("platform_code = ?", platformCode)
	}
	var rows []appPlatformRelRecord
	if err := q.Order("app_code ASC, platform_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list app-platform relations: %w", err)
	}
	out := make([]AppPlatformRel, 0, len(rows))
	for _, row := range rows {
		out = append(out, AppPlatformRel{
			RelID:        row.ID,
			AppCode:      row.AppCode,
			PlatformCode: row.PlatformCode,
			IsPrimary:    row.IsPrimary,
		})
	}
	return out, nil
}

func (r *GORMRepository) CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error) {
	var out *AppPlatformRel
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rel, err := createAppPlatformRelTx(tx, appCode, platformCode, isPrimary)
		if err != nil {
			return err
		}
		out = rel
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// createAppPlatformRelTx enforces the organization invariants (D42) inside a
// transaction: the first relation of an application is always its primary
// platform, and a second primary platform is rejected.
func createAppPlatformRelTx(tx *gorm.DB, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error) {
	var existing int64
	if err := tx.Model(&appPlatformRelRecord{}).
		Where("app_code = ? AND platform_code = ?", appCode, platformCode).
		Count(&existing).Error; err != nil {
		return nil, fmt.Errorf("check app-platform relation: %w", err)
	}
	if existing > 0 {
		return nil, ErrAppPlatformRelExists
	}

	// I2（D42）：首个关联必为主平台——应用必须归属平台且恰有一个主平台。
	var total int64
	if err := tx.Model(&appPlatformRelRecord{}).
		Where("app_code = ?", appCode).
		Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count app-platform relations: %w", err)
	}
	if total == 0 {
		isPrimary = true
	}

	if isPrimary {
		var primary int64
		if err := tx.Model(&appPlatformRelRecord{}).
			Where("app_code = ? AND is_primary = ?", appCode, true).
			Count(&primary).Error; err != nil {
			return nil, fmt.Errorf("check primary platform: %w", err)
		}
		if primary > 0 {
			return nil, ErrPrimaryPlatformExists
		}
	}

	id, err := domain.NewResourceID()
	if err != nil {
		return nil, err
	}
	rec := &appPlatformRelRecord{
		ID:           id,
		AppCode:      appCode,
		PlatformCode: platformCode,
		IsPrimary:    isPrimary,
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}
	if err := tx.Create(rec).Error; err != nil {
		return nil, fmt.Errorf("create app-platform relation: %w", err)
	}
	return &AppPlatformRel{
		RelID: rec.ID, AppCode: rec.AppCode, PlatformCode: rec.PlatformCode, IsPrimary: rec.IsPrimary,
	}, nil
}

func (r *GORMRepository) SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error) {
	var out *AppPlatformRel
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rec appPlatformRelRecord
		if err := tx.Where("id = ?", relID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAppPlatformRelNotFound
			}
			return fmt.Errorf("load app-platform relation: %w", err)
		}
		if isPrimary {
			if err := tx.Model(&appPlatformRelRecord{}).
				Where("app_code = ? AND is_primary = ?", rec.AppCode, true).
				Update("is_primary", false).Error; err != nil {
				return fmt.Errorf("clear primary platform: %w", err)
			}
		} else if rec.IsPrimary {
			// I2 / I3（D42）：主平台只能「转移」不能「取消」，撤销会留下无主平台的应用。
			return ErrPrimaryPlatformTransferRequired
		}
		if err := tx.Model(&rec).Updates(map[string]any{
			"is_primary": isPrimary,
			"updated_at": time.Now().UTC(),
		}).Error; err != nil {
			return fmt.Errorf("set primary platform: %w", err)
		}
		rec.IsPrimary = isPrimary
		out = &AppPlatformRel{
			RelID: rec.ID, AppCode: rec.AppCode, PlatformCode: rec.PlatformCode, IsPrimary: rec.IsPrimary,
		}
		return nil
	})
	return out, err
}

// DeleteAppPlatformRel removes one relation after enforcing the organization
// invariants (D42): an application must keep at least one platform (I1), and
// its primary platform can only be removed after an explicit transfer (I3).
func (r *GORMRepository) DeleteAppPlatformRel(ctx context.Context, relID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rec appPlatformRelRecord
		if err := tx.Where("id = ?", relID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAppPlatformRelNotFound
			}
			return fmt.Errorf("load app-platform relation: %w", err)
		}

		var total int64
		if err := tx.Model(&appPlatformRelRecord{}).
			Where("app_code = ?", rec.AppCode).
			Count(&total).Error; err != nil {
			return fmt.Errorf("count app-platform relations: %w", err)
		}
		// I1（D42）：应用必须归属至少一个平台。
		if total <= 1 {
			return ErrAppRequiresPlatform
		}
		// I3（D42）：主平台须显式转移，不自动提升（避免静默改变告警派单归属）。
		if rec.IsPrimary {
			return ErrPrimaryPlatformTransferRequired
		}

		result := tx.Where("id = ?", relID).Delete(&appPlatformRelRecord{})
		if result.Error != nil {
			return fmt.Errorf("delete app-platform relation: %w", result.Error)
		}
		if result.RowsAffected == 0 {
			return ErrAppPlatformRelNotFound
		}
		return nil
	})
}

func (r *GORMRepository) ListOSOptions(ctx context.Context) ([]OSOption, error) {
	options := models.ListOSOptions()
	out := make([]OSOption, 0, len(options))
	for _, option := range options {
		out = append(out, OSOption{Name: option.Name, Family: option.Family})
	}
	return out, nil
}

// dictionaryStatus derives the public four-state view (M07 SRS v2.0 §3.4).
// revoked and merged are terminal and take precedence over the enable flag,
// which stays authoritative for "selectable in dropdowns".
func dictionaryStatus(enabled bool, mergedInto *string, revokedAt *time.Time) string {
	switch {
	case revokedAt != nil:
		return DictionaryStatusRevoked
	case mergedInto != nil && strings.TrimSpace(*mergedInto) != "":
		return DictionaryStatusMerged
	case enabled:
		return DictionaryStatusEnabled
	default:
		return DictionaryStatusDisabled
	}
}

// --- reference counts -------------------------------------------------------

// businessDomainReferenceCounts returns biz_code -> live resource count in one
// grouped query (NFR-20: no N+1).
func (r *GORMRepository) businessDomainReferenceCounts(ctx context.Context) (map[string]int64, error) {
	var rows []struct {
		Code  string
		Total int64
	}
	err := r.db.WithContext(ctx).Table("resources").
		Select("biz_code AS code, COUNT(*) AS total").
		Where("biz_code IS NOT NULL AND biz_code <> '' AND deleted_at IS NULL").
		Group("biz_code").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count business domain references: %w", err)
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.Code] = row.Total
	}
	return out, nil
}

func (r *GORMRepository) applicationReferenceCounts(ctx context.Context) (map[string]int64, error) {
	var rows []struct {
		Code  string
		Total int64
	}
	err := r.db.WithContext(ctx).Table("resources").
		Select("app_code AS code, COUNT(*) AS total").
		Where("app_code IS NOT NULL AND app_code <> '' AND deleted_at IS NULL").
		Group("app_code").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count application references: %w", err)
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.Code] = row.Total
	}
	return out, nil
}

// platformReferenceCounts counts both resource references and organization
// references (app_platform_rels), because an application still mounted on a
// platform must keep that platform from being revoked.
func (r *GORMRepository) platformReferenceCounts(ctx context.Context) (map[string]int64, error) {
	out := make(map[string]int64)
	var resourceRows []struct {
		Code  string
		Total int64
	}
	err := r.db.WithContext(ctx).Table("resources").
		Select("platform_code AS code, COUNT(*) AS total").
		Where("platform_code IS NOT NULL AND platform_code <> '' AND deleted_at IS NULL").
		Group("platform_code").
		Scan(&resourceRows).Error
	if err != nil {
		return nil, fmt.Errorf("count platform resource references: %w", err)
	}
	for _, row := range resourceRows {
		out[row.Code] += row.Total
	}

	var relRows []struct {
		Code  string
		Total int64
	}
	err = r.db.WithContext(ctx).Table("app_platform_rels").
		Select("platform_code AS code, COUNT(*) AS total").
		Where("deleted_at IS NULL").
		Group("platform_code").
		Scan(&relRows).Error
	if err != nil {
		return nil, fmt.Errorf("count platform organization references: %w", err)
	}
	for _, row := range relRows {
		out[row.Code] += row.Total
	}
	return out, nil
}

func (r *GORMRepository) CountBusinessDomainReferences(ctx context.Context, code string) (int64, error) {
	counts, err := r.businessDomainReferenceCounts(ctx)
	if err != nil {
		return 0, err
	}
	return counts[code], nil
}

func (r *GORMRepository) CountApplicationReferences(ctx context.Context, code string) (int64, error) {
	counts, err := r.applicationReferenceCounts(ctx)
	if err != nil {
		return 0, err
	}
	return counts[code], nil
}

func (r *GORMRepository) CountPlatformReferences(ctx context.Context, code string) (int64, error) {
	counts, err := r.platformReferenceCounts(ctx)
	if err != nil {
		return 0, err
	}
	return counts[code], nil
}

// cloudReferenceCounts returns cloud_code -> live network-domain count.
// network_domains.cloud_code is the authoritative cloud label source (D103).
func (r *GORMRepository) cloudReferenceCounts(ctx context.Context) (map[string]int64, error) {
	var rows []struct {
		Code  string
		Total int64
	}
	err := r.db.WithContext(ctx).Table("network_domains").
		Select("cloud_code AS code, COUNT(*) AS total").
		Where("cloud_code IS NOT NULL AND cloud_code <> '' AND deleted_at IS NULL").
		Group("cloud_code").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("count cloud references: %w", err)
	}
	out := make(map[string]int64, len(rows))
	for _, row := range rows {
		out[row.Code] = row.Total
	}
	return out, nil
}

func (r *GORMRepository) CountCloudReferences(ctx context.Context, cloudCode string) (int64, error) {
	counts, err := r.cloudReferenceCounts(ctx)
	if err != nil {
		return 0, err
	}
	return counts[cloudCode], nil
}

// --- revoke (zero-reference only, terminal) ---------------------------------

func (r *GORMRepository) RevokeBusinessDomain(ctx context.Context, code, operator string) (*BusinessDomain, error) {
	var out *BusinessDomain
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row businessDomainRecord
		if err := tx.Where("code = ?", code).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrDictionaryNotFound
			}
			return fmt.Errorf("load business domain %q: %w", code, err)
		}
		if row.RevokedAt != nil || row.MergedInto != nil {
			return ErrDictionaryTerminal
		}
		count, err := countBusinessDomainReferencesTx(tx, code)
		if err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("%w: 业务分组 %q 仍被 %d 个资源引用，请先停用或合并", ErrDictionaryReferenced, code, count)
		}
		now := time.Now().UTC()
		if err := tx.Model(&row).Updates(map[string]any{
			"revoked_at": now, "enabled": false, "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("revoke business domain %q: %w", code, err)
		}
		if err := insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypeBusiness, Action: DictionaryActionRevoke,
			SourceCode: code, Operator: operator, CreatedAt: now,
		}); err != nil {
			return err
		}
		out = &BusinessDomain{
			Code: row.Code, Name: row.Name, Description: derefString(row.Description),
			Enabled: false, Status: DictionaryStatusRevoked,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *GORMRepository) RevokeApplication(ctx context.Context, appCode, operator string) (*Application, error) {
	var out *Application
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row applicationDictRecord
		if err := tx.Where("app_code = ?", appCode).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrDictionaryNotFound
			}
			return fmt.Errorf("load application %q: %w", appCode, err)
		}
		if row.RevokedAt != nil || row.MergedInto != nil {
			return ErrDictionaryTerminal
		}
		count, err := countApplicationReferencesTx(tx, appCode)
		if err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("%w: 应用 %q 仍被 %d 个资源引用，请先停用或合并", ErrDictionaryReferenced, appCode, count)
		}
		// 零资源引用的应用仍可能挂着平台归属；撤销后这些组织关系失去意义，
		// 在同一事务内软删，避免已撤销应用继续占用平台引用数。
		if err := tx.Where("app_code = ?", appCode).Delete(&appPlatformRelRecord{}).Error; err != nil {
			return fmt.Errorf("detach application %q from platforms: %w", appCode, err)
		}
		now := time.Now().UTC()
		if err := tx.Model(&row).Updates(map[string]any{
			"revoked_at": now, "status": "disabled", "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("revoke application %q: %w", appCode, err)
		}
		if err := insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypeApplication, Action: DictionaryActionRevoke,
			SourceCode: appCode, Operator: operator, CreatedAt: now,
		}); err != nil {
			return err
		}
		out = &Application{
			AppCode: row.AppCode, AppName: row.AppName, Description: derefString(row.Description),
			Status: DictionaryStatusRevoked,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *GORMRepository) RevokePlatform(ctx context.Context, platformCode, operator string) (*Platform, error) {
	var out *Platform
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row platformDictRecord
		if err := tx.Where("platform_code = ?", platformCode).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrDictionaryNotFound
			}
			return fmt.Errorf("load platform %q: %w", platformCode, err)
		}
		if row.RevokedAt != nil || row.MergedInto != nil {
			return ErrDictionaryTerminal
		}
		count, err := countPlatformReferencesTx(tx, platformCode)
		if err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("%w: 平台 %q 仍被 %d 处引用（资源 + 应用归属），请先停用或合并", ErrDictionaryReferenced, platformCode, count)
		}
		now := time.Now().UTC()
		if err := tx.Model(&row).Updates(map[string]any{
			"revoked_at": now, "enabled": false, "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("revoke platform %q: %w", platformCode, err)
		}
		if err := insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypePlatform, Action: DictionaryActionRevoke,
			SourceCode: platformCode, Operator: operator, CreatedAt: now,
		}); err != nil {
			return err
		}
		out = &Platform{
			PlatformCode: row.PlatformCode, PlatformName: row.PlatformName,
			Description: derefString(row.Description), Enabled: false,
			Status: DictionaryStatusRevoked,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (r *GORMRepository) RevokeCloud(ctx context.Context, cloudCode, operator string) (*Cloud, error) {
	var out *Cloud
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row cloudDictRecord
		if err := tx.Where("cloud_code = ?", cloudCode).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrDictionaryNotFound
			}
			return fmt.Errorf("load cloud %q: %w", cloudCode, err)
		}
		if row.RevokedAt != nil || row.MergedInto != nil {
			return ErrDictionaryTerminal
		}
		count, err := countCloudReferencesTx(tx, cloudCode)
		if err != nil {
			return err
		}
		if count > 0 {
			return fmt.Errorf("%w: 云 %q 仍被 %d 个网域引用，请先停用或合并", ErrDictionaryReferenced, cloudCode, count)
		}
		now := time.Now().UTC()
		if err := tx.Model(&row).Updates(map[string]any{
			"revoked_at": now, "enabled": false, "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("revoke cloud %q: %w", cloudCode, err)
		}
		if err := insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypeCloud, Action: DictionaryActionRevoke,
			SourceCode: cloudCode, Operator: operator, CreatedAt: now,
		}); err != nil {
			return err
		}
		out = &Cloud{
			CloudCode: row.CloudCode, CloudName: row.CloudName, CloudType: row.CloudType,
			Carrier: row.Carrier, Description: derefString(row.Description),
			Enabled: false, Status: DictionaryStatusRevoked,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// --- merge (terminal source, transactional reference migration) -------------

func (r *GORMRepository) MergeBusinessDomain(ctx context.Context, source, target, operator string) (int64, error) {
	var moved int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		src, err := loadBusinessDomainTx(tx, source)
		if err != nil {
			return err
		}
		if err := ensureMergeable(src.RevokedAt, src.MergedInto); err != nil {
			return err
		}
		dst, err := loadBusinessDomainTx(tx, target)
		if err != nil {
			return err
		}
		if !dst.Enabled || dst.RevokedAt != nil || dst.MergedInto != nil {
			return fmt.Errorf("%w: 目标业务分组 %q 未启用或已终止", ErrDictionaryMergeInvalid, target)
		}
		now := time.Now().UTC()
		result := tx.Table("resources").Where("biz_code = ?", source).Updates(map[string]any{
			"biz_code": target, "updated_at": now,
		})
		if result.Error != nil {
			return fmt.Errorf("migrate business references %q -> %q: %w", source, target, result.Error)
		}
		moved = result.RowsAffected

		if err := tx.Model(src).Updates(map[string]any{
			"merged_into": target, "enabled": false, "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("mark business domain %q merged: %w", source, err)
		}
		return insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypeBusiness, Action: DictionaryActionMerge,
			SourceCode: source, TargetCode: target, ReferenceCount: moved,
			Operator: operator, CreatedAt: now,
		})
	})
	if err != nil {
		return 0, err
	}
	return moved, nil
}

func (r *GORMRepository) MergeApplication(ctx context.Context, source, target, operator string) (int64, error) {
	var moved int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		src, err := loadApplicationTx(tx, source)
		if err != nil {
			return err
		}
		if err := ensureMergeable(src.RevokedAt, src.MergedInto); err != nil {
			return err
		}
		dst, err := loadApplicationTx(tx, target)
		if err != nil {
			return err
		}
		if dst.Status != "enabled" || dst.RevokedAt != nil || dst.MergedInto != nil {
			return fmt.Errorf("%w: 目标应用 %q 未启用或已终止", ErrDictionaryMergeInvalid, target)
		}
		now := time.Now().UTC()
		result := tx.Table("resources").Where("app_code = ?", source).Updates(map[string]any{
			"app_code": target, "updated_at": now,
		})
		if result.Error != nil {
			return fmt.Errorf("migrate application references %q -> %q: %w", source, target, result.Error)
		}
		moved = result.RowsAffected

		if err := migrateAppPlatformRelsTx(tx, source, target); err != nil {
			return err
		}

		if err := tx.Model(src).Updates(map[string]any{
			"merged_into": target, "status": "disabled", "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("mark application %q merged: %w", source, err)
		}
		return insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypeApplication, Action: DictionaryActionMerge,
			SourceCode: source, TargetCode: target, ReferenceCount: moved,
			Operator: operator, CreatedAt: now,
		})
	})
	if err != nil {
		return 0, err
	}
	return moved, nil
}

func (r *GORMRepository) MergePlatform(ctx context.Context, source, target, operator string) (int64, error) {
	var moved int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		src, err := loadPlatformTx(tx, source)
		if err != nil {
			return err
		}
		if err := ensureMergeable(src.RevokedAt, src.MergedInto); err != nil {
			return err
		}
		dst, err := loadPlatformTx(tx, target)
		if err != nil {
			return err
		}
		if !dst.Enabled || dst.RevokedAt != nil || dst.MergedInto != nil {
			return fmt.Errorf("%w: 目标平台 %q 未启用或已终止", ErrDictionaryMergeInvalid, target)
		}
		now := time.Now().UTC()
		result := tx.Table("resources").Where("platform_code = ?", source).Updates(map[string]any{
			"platform_code": target, "updated_at": now,
		})
		if result.Error != nil {
			return fmt.Errorf("migrate platform references %q -> %q: %w", source, target, result.Error)
		}
		moved = result.RowsAffected

		if err := migratePlatformRelsTx(tx, source, target); err != nil {
			return err
		}

		if err := tx.Model(src).Updates(map[string]any{
			"merged_into": target, "enabled": false, "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("mark platform %q merged: %w", source, err)
		}
		return insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypePlatform, Action: DictionaryActionMerge,
			SourceCode: source, TargetCode: target, ReferenceCount: moved,
			Operator: operator, CreatedAt: now,
		})
	})
	if err != nil {
		return 0, err
	}
	return moved, nil
}

// MergeCloud folds a cloud dictionary entry into another, migrating
// network_domains.cloud_code references in one transaction (D103: cloud label
// authority lives in network_domains, not in a resource-side column).
func (r *GORMRepository) MergeCloud(ctx context.Context, source, target, operator string) (int64, error) {
	var moved int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		src, err := loadCloudTx(tx, source)
		if err != nil {
			return err
		}
		if err := ensureMergeable(src.RevokedAt, src.MergedInto); err != nil {
			return err
		}
		dst, err := loadCloudTx(tx, target)
		if err != nil {
			return err
		}
		if !dst.Enabled || dst.RevokedAt != nil || dst.MergedInto != nil {
			return fmt.Errorf("%w: 目标云 %q 未启用或已终止", ErrDictionaryMergeInvalid, target)
		}
		now := time.Now().UTC()
		result := tx.Table("network_domains").Where("cloud_code = ?", source).Updates(map[string]any{
			"cloud_code": target, "updated_at": now,
		})
		if result.Error != nil {
			return fmt.Errorf("migrate cloud references %q -> %q: %w", source, target, result.Error)
		}
		moved = result.RowsAffected

		if err := tx.Model(src).Updates(map[string]any{
			"merged_into": target, "enabled": false, "updated_at": now,
		}).Error; err != nil {
			return fmt.Errorf("mark cloud %q merged: %w", source, err)
		}
		return insertDictionaryAuditTx(tx, DictionaryAuditLog{
			DictionaryType: dictionaryTypeCloud, Action: DictionaryActionMerge,
			SourceCode: source, TargetCode: target, ReferenceCount: moved,
			Operator: operator, CreatedAt: now,
		})
	})
	if err != nil {
		return 0, err
	}
	return moved, nil
}

// migrateAppPlatformRelsTx moves organization ownership from the merged
// application to the surviving one. Existing (app, platform) pairs collapse:
// the source relation is soft-deleted instead of producing a duplicate.
func migrateAppPlatformRelsTx(tx *gorm.DB, fromApp, toApp string) error {
	var rels []appPlatformRelRecord
	if err := tx.Where("app_code = ?", fromApp).Order("created_at ASC").Find(&rels).Error; err != nil {
		return fmt.Errorf("load app-platform relations of %q: %w", fromApp, err)
	}
	for _, rel := range rels {
		var existing appPlatformRelRecord
		err := tx.Where("app_code = ? AND platform_code = ?", toApp, rel.PlatformCode).
			First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			if err := tx.Model(&appPlatformRelRecord{}).Where("id = ?", rel.ID).Updates(map[string]any{
				"app_code": toApp, "updated_at": time.Now().UTC(),
			}).Error; err != nil {
				return fmt.Errorf("move app-platform relation to %q: %w", toApp, err)
			}
		case err != nil:
			return fmt.Errorf("check target app-platform relation: %w", err)
		default:
			if rel.IsPrimary && !existing.IsPrimary {
				if err := tx.Model(&appPlatformRelRecord{}).Where("id = ?", existing.ID).
					Update("is_primary", true).Error; err != nil {
					return fmt.Errorf("promote target primary platform: %w", err)
				}
			}
			if err := tx.Delete(&appPlatformRelRecord{}, "id = ?", rel.ID).Error; err != nil {
				return fmt.Errorf("drop duplicate app-platform relation: %w", err)
			}
		}
	}
	return ensurePrimaryAppPlatformTx(tx, toApp)
}

// migratePlatformRelsTx moves application ownership from the merged platform
// to the surviving one, collapsing duplicate (app, platform) pairs.
func migratePlatformRelsTx(tx *gorm.DB, fromPlatform, toPlatform string) error {
	var rels []appPlatformRelRecord
	if err := tx.Where("platform_code = ?", fromPlatform).Order("created_at ASC").Find(&rels).Error; err != nil {
		return fmt.Errorf("load app-platform relations of %q: %w", fromPlatform, err)
	}
	for _, rel := range rels {
		var existing appPlatformRelRecord
		err := tx.Where("app_code = ? AND platform_code = ?", rel.AppCode, toPlatform).
			First(&existing).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			if err := tx.Model(&appPlatformRelRecord{}).Where("id = ?", rel.ID).Updates(map[string]any{
				"platform_code": toPlatform, "updated_at": time.Now().UTC(),
			}).Error; err != nil {
				return fmt.Errorf("move app-platform relation to platform %q: %w", toPlatform, err)
			}
		case err != nil:
			return fmt.Errorf("check target app-platform relation: %w", err)
		default:
			if rel.IsPrimary && !existing.IsPrimary {
				if err := tx.Model(&appPlatformRelRecord{}).Where("id = ?", existing.ID).
					Update("is_primary", true).Error; err != nil {
					return fmt.Errorf("promote surviving primary platform: %w", err)
				}
			}
			if err := tx.Delete(&appPlatformRelRecord{}, "id = ?", rel.ID).Error; err != nil {
				return fmt.Errorf("drop duplicate app-platform relation: %w", err)
			}
		}
	}
	return ensurePrimaryAppPlatformTx(tx, "")
}

// ensurePrimaryAppPlatformTx repairs the "exactly one primary platform"
// invariant after a merge. An empty appCode means "check every affected app".
func ensurePrimaryAppPlatformTx(tx *gorm.DB, appCode string) error {
	q := tx.Model(&appPlatformRelRecord{})
	if appCode != "" {
		q = q.Where("app_code = ?", appCode)
	}
	var apps []string
	if err := q.Distinct().Pluck("app_code", &apps).Error; err != nil {
		return fmt.Errorf("list apps for primary repair: %w", err)
	}
	for _, app := range apps {
		var primaries int64
		if err := tx.Model(&appPlatformRelRecord{}).
			Where("app_code = ? AND is_primary = ?", app, true).
			Count(&primaries).Error; err != nil {
			return fmt.Errorf("count primary platforms of %q: %w", app, err)
		}
		if primaries > 0 {
			continue
		}
		var first appPlatformRelRecord
		if err := tx.Where("app_code = ?", app).Order("created_at ASC").First(&first).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return fmt.Errorf("load app-platform relation of %q: %w", app, err)
		}
		if err := tx.Model(&first).Update("is_primary", true).Error; err != nil {
			return fmt.Errorf("restore primary platform of %q: %w", app, err)
		}
	}
	return nil
}

// --- audit log --------------------------------------------------------------

const (
	dictionaryTypeBusiness    = "business"
	dictionaryTypeApplication = "application"
	dictionaryTypePlatform    = "platform"
	dictionaryTypeCloud       = "cloud"
)

func insertDictionaryAuditTx(tx *gorm.DB, entry DictionaryAuditLog) error {
	id, err := domain.NewResourceID()
	if err != nil {
		return err
	}
	createdAt := entry.CreatedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	rec := &dictionaryAuditLogRecord{
		ID:             id,
		DictionaryType: entry.DictionaryType,
		Action:         entry.Action,
		SourceCode:     entry.SourceCode,
		TargetCode:     entry.TargetCode,
		ReferenceCount: entry.ReferenceCount,
		Operator:       entry.Operator,
		Detail:         entry.Detail,
		CreatedAt:      createdAt,
	}
	if err := tx.Create(rec).Error; err != nil {
		return fmt.Errorf("write dictionary audit log: %w", err)
	}
	return nil
}

func (r *GORMRepository) ListDictionaryAuditLogs(ctx context.Context, dictionaryType, code string, limit int) ([]DictionaryAuditLog, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	q := r.db.WithContext(ctx).Model(&dictionaryAuditLogRecord{})
	if dictionaryType != "" {
		q = q.Where("dictionary_type = ?", dictionaryType)
	}
	if code != "" {
		q = q.Where("source_code = ? OR target_code = ?", code, code)
	}
	var rows []dictionaryAuditLogRecord
	if err := q.Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list dictionary audit logs: %w", err)
	}
	out := make([]DictionaryAuditLog, 0, len(rows))
	for _, row := range rows {
		out = append(out, DictionaryAuditLog{
			ID: row.ID, DictionaryType: row.DictionaryType, Action: row.Action,
			SourceCode: row.SourceCode, TargetCode: row.TargetCode,
			ReferenceCount: row.ReferenceCount, Operator: row.Operator,
			Detail: row.Detail, CreatedAt: row.CreatedAt,
		})
	}
	return out, nil
}

// --- transactional loaders / counters ---------------------------------------

func loadBusinessDomainTx(tx *gorm.DB, code string) (*businessDomainRecord, error) {
	var row businessDomainRecord
	if err := tx.Where("code = ?", code).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load business domain %q: %w", code, err)
	}
	return &row, nil
}

func loadApplicationTx(tx *gorm.DB, appCode string) (*applicationDictRecord, error) {
	var row applicationDictRecord
	if err := tx.Where("app_code = ?", appCode).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load application %q: %w", appCode, err)
	}
	return &row, nil
}

func loadPlatformTx(tx *gorm.DB, platformCode string) (*platformDictRecord, error) {
	var row platformDictRecord
	if err := tx.Where("platform_code = ?", platformCode).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load platform %q: %w", platformCode, err)
	}
	return &row, nil
}

func loadCloudTx(tx *gorm.DB, cloudCode string) (*cloudDictRecord, error) {
	var row cloudDictRecord
	if err := tx.Where("cloud_code = ?", cloudCode).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDictionaryNotFound
		}
		return nil, fmt.Errorf("load cloud %q: %w", cloudCode, err)
	}
	return &row, nil
}

func ensureMergeable(revokedAt *time.Time, mergedInto *string) error {
	if revokedAt != nil {
		return fmt.Errorf("%w: 源条目已撤销，不能合并", ErrDictionaryTerminal)
	}
	if mergedInto != nil && strings.TrimSpace(*mergedInto) != "" {
		return fmt.Errorf("%w: 源条目已合并，不能再次合并", ErrDictionaryTerminal)
	}
	return nil
}

func countBusinessDomainReferencesTx(tx *gorm.DB, code string) (int64, error) {
	var count int64
	if err := tx.Table("resources").
		Where("biz_code = ? AND deleted_at IS NULL", code).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count business domain references: %w", err)
	}
	return count, nil
}

func countApplicationReferencesTx(tx *gorm.DB, code string) (int64, error) {
	var count int64
	if err := tx.Table("resources").
		Where("app_code = ? AND deleted_at IS NULL", code).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count application references: %w", err)
	}
	return count, nil
}

func countPlatformReferencesTx(tx *gorm.DB, code string) (int64, error) {
	var resources int64
	if err := tx.Table("resources").
		Where("platform_code = ? AND deleted_at IS NULL", code).
		Count(&resources).Error; err != nil {
		return 0, fmt.Errorf("count platform references: %w", err)
	}
	var rels int64
	if err := tx.Table("app_platform_rels").
		Where("platform_code = ? AND deleted_at IS NULL", code).
		Count(&rels).Error; err != nil {
		return 0, fmt.Errorf("count platform organization references: %w", err)
	}
	return resources + rels, nil
}

func countCloudReferencesTx(tx *gorm.DB, cloudCode string) (int64, error) {
	var count int64
	if err := tx.Table("network_domains").
		Where("cloud_code = ? AND deleted_at IS NULL", cloudCode).
		Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count cloud references: %w", err)
	}
	return count, nil
}


