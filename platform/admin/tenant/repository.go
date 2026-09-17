package tenant

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Repository 封装 tenants 表（注册表）的持久化访问。
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository backed by db.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// FindByID returns the tenant with the given id, or ErrNotFound.
func (r *Repository) FindByID(id string) (*models.Tenant, error) {
	var tn models.Tenant
	err := r.db.First(&tn, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find tenant %q: %w", id, err)
	}
	return &tn, nil
}

// ListTenants returns a page of tenants ordered by created_at asc plus the
// total count（全量总数，非当前页条数）。status 非空时仅返回该状态的租户（
// 承接原 networkdomain 版「租户授权字典」的可选 status 筛选能力）。
func (r *Repository) ListTenants(page, pageSize int, status string) ([]models.Tenant, int64, error) {
	q := r.db.Model(&models.Tenant{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count tenants: %w", err)
	}
	list := []models.Tenant{}
	if err := q.Order("created_at asc").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list tenants: %w", err)
	}
	return list, total, nil
}

// Save persists mutations of an existing tenant row.
func (r *Repository) Save(tn *models.Tenant) error {
	if err := r.db.Save(tn).Error; err != nil {
		return fmt.Errorf("save tenant %q: %w", tn.ID, err)
	}
	return nil
}