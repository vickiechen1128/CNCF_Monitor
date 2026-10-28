package blackboxmodule

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Repository 封装拨测模块与 Job 引用的数据库访问。
type Repository struct {
	db *gorm.DB
}

// NewRepository 创建拨测模块仓储。
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Migrate 自注册模块 schema，并幂等补齐预置模块。
func (r *Repository) Migrate() error {
	if err := r.db.AutoMigrate(&models.BlackboxModule{}); err != nil {
		return fmt.Errorf("migrate blackbox modules: %w", err)
	}
	for _, module := range models.DefaultBlackboxModules() {
		var count int64
		if err := r.db.Model(&models.BlackboxModule{}).Where("name = ?", module.Name).Count(&count).Error; err != nil {
			return fmt.Errorf("check blackbox module %s: %w", module.Name, err)
		}
		if count == 0 {
			if err := r.db.Create(&module).Error; err != nil {
				return fmt.Errorf("seed blackbox module %s: %w", module.Name, err)
			}
		}
	}
	return nil
}

func (r *Repository) list() ([]models.BlackboxModule, error) {
	var items []models.BlackboxModule
	if err := r.db.Order("name ASC").Find(&items).Error; err != nil {
		return nil, fmt.Errorf("list blackbox modules: %w", err)
	}
	return items, nil
}

func (r *Repository) getByID(id uint) (*models.BlackboxModule, error) {
	var item models.BlackboxModule
	if err := r.db.First(&item, id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) getByName(name string) (*models.BlackboxModule, error) {
	var item models.BlackboxModule
	if err := r.db.Where("name = ?", name).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) create(item *models.BlackboxModule) error {
	return r.db.Create(item).Error
}

func (r *Repository) update(item *models.BlackboxModule) error {
	return r.db.Model(item).Updates(map[string]interface{}{
		"content": item.Content,
		"enabled": item.Enabled,
	}).Error
}

func (r *Repository) delete(id uint) error {
	return r.db.Delete(&models.BlackboxModule{}, id).Error
}

func (r *Repository) referencedJobs(name string) (int64, error) {
	var total int64
	if err := r.db.Model(&models.ScrapeJob{}).
		Where("job_type = ? AND blackbox_module = ?", models.JobTypeBlackbox, name).
		Count(&total).Error; err != nil {
		return 0, fmt.Errorf("count blackbox module references: %w", err)
	}
	return total, nil
}

func isNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
