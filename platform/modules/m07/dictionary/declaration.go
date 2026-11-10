package dictionary

import (
	"context"
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeclaredEntry is a dictionary entry declared in an import workbook.
type DeclaredEntry struct {
	Code        string
	Name        string
	Description string
}

// DeclarationWriter applies declaration sheets.
type DeclarationWriter interface {
	EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error
}

// EnsureDeclarations applies the three declaration groups.
func (r *GORMRepository) EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error {
	if err := r.EnsureDeclaredBusinessDomains(ctx, biz); err != nil {
		return err
	}
	if err := r.EnsureDeclaredApplications(ctx, app); err != nil {
		return err
	}
	return r.EnsureDeclaredPlatforms(ctx, platform)
}

// EnsureDeclaredBusinessDomains creates missing business entries.
func (r *GORMRepository) EnsureDeclaredBusinessDomains(ctx context.Context, entries []DeclaredEntry) error {
	for _, entry := range entries {
		var row models.BusinessDomain
		err := r.db.WithContext(ctx).Where("code = ?", entry.Code).First(&row).Error
		if err == nil {
			if row.Name != entry.Name {
				return fmt.Errorf("declared business %q name mismatch: declared %q, existing %q", entry.Code, entry.Name, row.Name)
			}
			if !row.Enabled {
				return fmt.Errorf("declared business %q is disabled; enable it before importing", entry.Code)
			}
			continue
		}
		if !isNotFound(err) {
			return fmt.Errorf("check declared business %q: %w", entry.Code, err)
		}
		row = models.BusinessDomain{
			Code: entry.Code, Name: entry.Name, Description: entry.Description,
			Enabled: true, Source: models.DictSourceExcelImport,
		}
		if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
			return fmt.Errorf("create declared business %q: %w", entry.Code, err)
		}
	}
	return nil
}

// EnsureDeclaredApplications creates missing application entries.
func (r *GORMRepository) EnsureDeclaredApplications(ctx context.Context, entries []DeclaredEntry) error {
	for _, entry := range entries {
		var row models.ApplicationDict
		err := r.db.WithContext(ctx).Where("app_code = ?", entry.Code).First(&row).Error
		if err == nil {
			if row.AppName != entry.Name {
				return fmt.Errorf("declared application %q name mismatch: declared %q, existing %q", entry.Code, entry.Name, row.AppName)
			}
			if row.Status != models.AppStatusEnabled {
				return fmt.Errorf("declared application %q is disabled; enable it before importing", entry.Code)
			}
			continue
		}
		if !isNotFound(err) {
			return fmt.Errorf("check declared application %q: %w", entry.Code, err)
		}
		row = models.ApplicationDict{
			AppCode: entry.Code, AppName: entry.Name, Description: entry.Description,
			Status: models.AppStatusEnabled, Source: models.DictSourceExcelImport,
		}
		if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
			return fmt.Errorf("create declared application %q: %w", entry.Code, err)
		}
	}
	return nil
}

// EnsureDeclaredPlatforms creates missing platform entries.
func (r *GORMRepository) EnsureDeclaredPlatforms(ctx context.Context, entries []DeclaredEntry) error {
	for _, entry := range entries {
		var row models.PlatformDict
		err := r.db.WithContext(ctx).Where("platform_code = ?", entry.Code).First(&row).Error
		if err == nil {
			if row.PlatformName != entry.Name {
				return fmt.Errorf("declared platform %q name mismatch: declared %q, existing %q", entry.Code, entry.Name, row.PlatformName)
			}
			if !row.Enabled {
				return fmt.Errorf("declared platform %q is disabled; enable it before importing", entry.Code)
			}
			continue
		}
		if !isNotFound(err) {
			return fmt.Errorf("check declared platform %q: %w", entry.Code, err)
		}
		row = models.PlatformDict{
			PlatformCode: entry.Code, PlatformName: entry.Name, Description: entry.Description,
			Enabled: true, Source: models.DictSourceExcelImport,
		}
		if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
			return fmt.Errorf("create declared platform %q: %w", entry.Code, err)
		}
	}
	return nil
}

func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
