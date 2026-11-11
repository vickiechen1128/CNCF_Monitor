// Package repository implements M06 v3 persistence.
package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"gorm.io/gorm"
)

// ListTenantsFilter carries tenant list filters.
type ListTenantsFilter struct {
	Status   string
	Keyword  string
	Page     int
	PageSize int
}

// TenantRepository reads and mutates tenants.
type TenantRepository interface {
	List(ctx context.Context, filter ListTenantsFilter) ([]*domain.Tenant, int64, error)
	Get(ctx context.Context, id string) (*domain.Tenant, error)
	Update(ctx context.Context, id string, input domain.UpdateTenantInput) (*domain.Tenant, error)
}

// GORMRepository is the GORM-backed M06 repository.
type GORMRepository struct {
	db *gorm.DB
}

// NewGORMRepository constructs a repository.
func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}

// List returns tenants matching the filters in created_at/id order.
func (r *GORMRepository) List(ctx context.Context, filter ListTenantsFilter) ([]*domain.Tenant, int64, error) {
	query := r.db.WithContext(ctx).Model(&models.Tenant{}).Where("deleted_at IS NULL")
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(id LIKE ? OR name LIKE ?)", like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count tenants: %w", err)
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}

	var rows []models.Tenant
	if err := query.Order("created_at ASC, id ASC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list tenants: %w", err)
	}
	out := make([]*domain.Tenant, 0, len(rows))
	for i := range rows {
		out = append(out, toDomain(&rows[i]))
	}
	return out, total, nil
}

// Get returns one tenant or domain.TenantNotFoundError.
func (r *GORMRepository) Get(ctx context.Context, id string) (*domain.Tenant, error) {
	var row models.Tenant
	err := r.db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &domain.TenantNotFoundError{TenantID: id}
	}
	if err != nil {
		return nil, fmt.Errorf("get tenant %q: %w", id, err)
	}
	return toDomain(&row), nil
}

// Update applies mutable tenant fields and returns the persisted row.
func (r *GORMRepository) Update(ctx context.Context, id string, input domain.UpdateTenantInput) (*domain.Tenant, error) {
	updates := map[string]any{}
	if input.Name != nil {
		updates["name"] = strings.TrimSpace(*input.Name)
	}
	if input.MultiSiteEnabled != nil {
		updates["multi_site_enabled"] = *input.MultiSiteEnabled
	}
	result := r.db.WithContext(ctx).Model(&models.Tenant{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(updates)
	if result.Error != nil {
		return nil, fmt.Errorf("update tenant %q: %w", id, result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, &domain.TenantNotFoundError{TenantID: id}
	}
	return r.Get(ctx, id)
}

func toDomain(row *models.Tenant) *domain.Tenant {
	domains := append([]string(nil), row.NetworkDomainIDs...)
	return &domain.Tenant{
		ID:               row.ID,
		Name:             row.Name,
		NetworkDomainIDs: domains,
		MultiSiteEnabled: row.MultiSiteEnabled,
		IsPlatformAdmin:  row.IsPlatformAdmin,
		Status:           domain.TenantStatus(row.Status),
		CreatedAt:        row.CreatedAt,
		UpdatedAt:        row.UpdatedAt,
	}
}
