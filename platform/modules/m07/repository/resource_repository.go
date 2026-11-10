package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"gorm.io/gorm"
)

func (r *GORMRepository) Create(ctx context.Context, resource *domain.Resource) error {
	if err := resource.Validate(); err != nil {
		return err
	}
	if err := resource.EnsureDedupKey(); err != nil {
		return err
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(toResourceRecord(resource)).Error; err != nil {
			return mapWriteError(err, resource.DedupKey)
		}
		ext, err := toExtensionRecord(resource.Category, resource.ResourceID, resource.Attributes)
		if err != nil {
			return err
		}
		if err := tx.Create(ext).Error; err != nil {
			return mapWriteError(err, resource.DedupKey)
		}
		return nil
	})
}

func (r *GORMRepository) Get(ctx context.Context, resourceID string) (*domain.Resource, error) {
	base, err := r.findBase(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	ext, err := r.loadExtension(ctx, domain.Category(base.ResourceCategory), resourceID)
	if err != nil {
		return nil, err
	}
	return fromResourceRecord(base, ext)
}

func (r *GORMRepository) List(ctx context.Context, filter ListFilter) ([]*domain.Resource, int64, error) {
	if !filter.Category.Valid() {
		return nil, 0, &domain.UnsupportedCategoryError{Category: string(filter.Category)}
	}
	page, pageSize := normalizePage(filter.Page, filter.PageSize)

	q := r.db.WithContext(ctx).Model(&resourceRecord{}).
		Where("resource_category = ?", string(filter.Category))
	if filter.NetworkDomainID != "" {
		q = q.Where("network_domain_id = ?", filter.NetworkDomainID)
	}
	if filter.BizCode != "" {
		q = q.Where("biz_code = ?", filter.BizCode)
	}
	if filter.AppCode != "" {
		q = q.Where("app_code = ?", filter.AppCode)
	}
	if filter.PlatformCode != "" {
		q = q.Where("platform_code = ?", filter.PlatformCode)
	}
	if filter.Status != "" {
		q = q.Where("status = ?", string(filter.Status))
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		q = q.Where("resource_id IN (?)", r.keywordSubquery(ctx, filter.Category, keyword))
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count resources: %w", err)
	}

	var bases []resourceRecord
	if err := q.Order("created_at DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&bases).Error; err != nil {
		return nil, 0, fmt.Errorf("list resources: %w", err)
	}
	if len(bases) == 0 {
		return []*domain.Resource{}, total, nil
	}

	ids := make([]string, 0, len(bases))
	for i := range bases {
		ids = append(ids, bases[i].ResourceID)
	}
	extensions, err := r.loadExtensions(ctx, filter.Category, ids)
	if err != nil {
		return nil, 0, err
	}

	out := make([]*domain.Resource, 0, len(bases))
	for i := range bases {
		resource, err := fromResourceRecord(&bases[i], extensions[bases[i].ResourceID])
		if err != nil {
			return nil, 0, err
		}
		out = append(out, resource)
	}
	return out, total, nil
}

func (r *GORMRepository) Update(ctx context.Context, resource *domain.Resource) error {
	if err := resource.Validate(); err != nil {
		return err
	}
	if err := resource.EnsureDedupKey(); err != nil {
		return err
	}

	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		updates := map[string]any{
			"network_domain_id": resource.NetworkDomainID,
			"biz_code":          nullable(resource.BizCode),
			"app_code":          nullable(resource.AppCode),
			"platform_code":     nullable(resource.PlatformCode),
			"env":               string(resource.Env),
			"cluster":           nullable(resource.Cluster),
			"owner":             nullable(resource.Owner),
			"status":            string(resource.Status),
			"scrape_port":       resource.ScrapePort,
			"dedup_key":         resource.DedupKey,
			"updated_at":        time.Now().UTC(),
		}
		result := tx.Model(&resourceRecord{}).
			Where("resource_id = ?", resource.ResourceID).
			Updates(updates)
		if result.Error != nil {
			return mapWriteError(result.Error, resource.DedupKey)
		}
		if result.RowsAffected == 0 {
			return &domain.NotFoundError{ResourceID: resource.ResourceID}
		}

		ext, err := toExtensionRecord(resource.Category, resource.ResourceID, resource.Attributes)
		if err != nil {
			return err
		}
		result = tx.Model(ext).
			Where("resource_id = ?", resource.ResourceID).
			Select("*").
			Omit("resource_id").
			Updates(ext)
		if result.Error != nil {
			return fmt.Errorf("update %s extension: %w", resource.Category, result.Error)
		}
		if result.RowsAffected == 0 {
			return fmt.Errorf("%s extension missing for %s", resource.Category, resource.ResourceID)
		}
		return nil
	})
}

func (r *GORMRepository) SoftDelete(ctx context.Context, resourceID string) error {
	result := r.db.WithContext(ctx).
		Where("resource_id = ?", resourceID).
		Delete(&resourceRecord{})
	if result.Error != nil {
		return fmt.Errorf("soft delete resource %s: %w", resourceID, result.Error)
	}
	if result.RowsAffected == 0 {
		return &domain.NotFoundError{ResourceID: resourceID}
	}
	return nil
}

func (r *GORMRepository) FindByDedupKey(ctx context.Context, category domain.Category, dedupKey string) (*domain.Resource, bool, error) {
	if !category.Valid() {
		return nil, false, &domain.UnsupportedCategoryError{Category: string(category)}
	}
	var base resourceRecord
	err := r.db.WithContext(ctx).
		Where("resource_category = ? AND dedup_key = ?", string(category), dedupKey).
		First(&base).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("find resource by dedup key: %w", err)
	}
	ext, err := r.loadExtension(ctx, category, base.ResourceID)
	if err != nil {
		return nil, false, err
	}
	resource, err := fromResourceRecord(&base, ext)
	if err != nil {
		return nil, false, err
	}
	return resource, true, nil
}

func (r *GORMRepository) findBase(ctx context.Context, resourceID string) (*resourceRecord, error) {
	var base resourceRecord
	err := r.db.WithContext(ctx).
		Where("resource_id = ?", resourceID).
		First(&base).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &domain.NotFoundError{ResourceID: resourceID}
	}
	if err != nil {
		return nil, fmt.Errorf("get resource %s: %w", resourceID, err)
	}
	return &base, nil
}

func (r *GORMRepository) loadExtension(ctx context.Context, category domain.Category, resourceID string) (any, error) {
	switch category {
	case domain.CategoryHost:
		var rec hostRecord
		return loadOne(ctx, r.db, &rec, resourceID)
	case domain.CategoryDatabase:
		var rec databaseRecord
		return loadOne(ctx, r.db, &rec, resourceID)
	case domain.CategoryMiddleware:
		var rec middlewareRecord
		return loadOne(ctx, r.db, &rec, resourceID)
	case domain.CategoryApplication:
		var rec applicationRecord
		return loadOne(ctx, r.db, &rec, resourceID)
	case domain.CategoryGenericTarget:
		var rec genericTargetRecord
		return loadOne(ctx, r.db, &rec, resourceID)
	case domain.CategoryInterfaceService:
		var rec interfaceServiceRecord
		return loadOne(ctx, r.db, &rec, resourceID)
	default:
		return nil, &domain.UnsupportedCategoryError{Category: string(category)}
	}
}

func loadOne(ctx context.Context, db *gorm.DB, dest any, resourceID string) (any, error) {
	err := db.WithContext(ctx).Where("resource_id = ?", resourceID).First(dest).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("extension missing for resource %s", resourceID)
	}
	if err != nil {
		return nil, fmt.Errorf("load extension for %s: %w", resourceID, err)
	}
	return dest, nil
}

func (r *GORMRepository) loadExtensions(ctx context.Context, category domain.Category, ids []string) (map[string]any, error) {
	out := make(map[string]any, len(ids))
	switch category {
	case domain.CategoryHost:
		var rows []hostRecord
		if err := r.db.WithContext(ctx).Where("resource_id IN ?", ids).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("load host extensions: %w", err)
		}
		for i := range rows {
			out[rows[i].ResourceID] = &rows[i]
		}
	case domain.CategoryDatabase:
		var rows []databaseRecord
		if err := r.db.WithContext(ctx).Where("resource_id IN ?", ids).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("load database extensions: %w", err)
		}
		for i := range rows {
			out[rows[i].ResourceID] = &rows[i]
		}
	case domain.CategoryMiddleware:
		var rows []middlewareRecord
		if err := r.db.WithContext(ctx).Where("resource_id IN ?", ids).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("load middleware extensions: %w", err)
		}
		for i := range rows {
			out[rows[i].ResourceID] = &rows[i]
		}
	case domain.CategoryApplication:
		var rows []applicationRecord
		if err := r.db.WithContext(ctx).Where("resource_id IN ?", ids).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("load application extensions: %w", err)
		}
		for i := range rows {
			out[rows[i].ResourceID] = &rows[i]
		}
	case domain.CategoryGenericTarget:
		var rows []genericTargetRecord
		if err := r.db.WithContext(ctx).Where("resource_id IN ?", ids).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("load generic_target extensions: %w", err)
		}
		for i := range rows {
			out[rows[i].ResourceID] = &rows[i]
		}
	case domain.CategoryInterfaceService:
		var rows []interfaceServiceRecord
		if err := r.db.WithContext(ctx).Where("resource_id IN ?", ids).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("load interface_service extensions: %w", err)
		}
		for i := range rows {
			out[rows[i].ResourceID] = &rows[i]
		}
	default:
		return nil, &domain.UnsupportedCategoryError{Category: string(category)}
	}
	return out, nil
}

func (r *GORMRepository) keywordSubquery(ctx context.Context, category domain.Category, keyword string) *gorm.DB {
	pattern := "%" + keyword + "%"
	switch category {
	case domain.CategoryHost:
		return r.db.WithContext(ctx).Table("host_resources").Select("resource_id").
			Where("hostname LIKE ? OR instance_ip LIKE ?", pattern, pattern)
	case domain.CategoryDatabase:
		return r.db.WithContext(ctx).Table("database_resources").Select("resource_id").
			Where("instance_ip LIKE ?", pattern)
	case domain.CategoryMiddleware:
		return r.db.WithContext(ctx).Table("middleware_resources").Select("resource_id").
			Where("instance_ip LIKE ?", pattern)
	case domain.CategoryApplication:
		return r.db.WithContext(ctx).Table("application_resources").Select("resource_id").
			Where("service_name LIKE ? OR endpoint LIKE ? OR health_check_url LIKE ?", pattern, pattern, pattern)
	case domain.CategoryGenericTarget:
		return r.db.WithContext(ctx).Table("generic_target_resources").Select("resource_id").
			Where("target_name LIKE ? OR instance_ip LIKE ?", pattern, pattern)
	case domain.CategoryInterfaceService:
		return r.db.WithContext(ctx).Table("interface_service_resources").Select("resource_id").
			Where("api_name LIKE ? OR api_url LIKE ?", pattern, pattern)
	default:
		return r.db.WithContext(ctx).Table("resources").Select("resource_id").Where("1 = 0")
	}
}

func normalizePage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func mapWriteError(err error, dedupKey string) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "23505") {
		return &domain.ConflictError{DedupKey: dedupKey}
	}
	return err
}
