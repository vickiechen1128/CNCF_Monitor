package panelmount

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Repository persists dashboard panel configurations.
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a dashboard panel repository.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// Create stores a panel unless its display name already exists.
func (r *Repository) Create(panel *models.DashboardPanel) error {
	var existing models.DashboardPanel
	err := r.db.Where("name = ?", panel.Name).First(&existing).Error
	if err == nil {
		return ErrNameConflict
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("check dashboard panel name: %w", err)
	}
	if err := r.db.Create(panel).Error; err != nil {
		return fmt.Errorf("create dashboard panel: %w", err)
	}
	return nil
}

// Update changes panel name and URL while rejecting names used by other panels.
func (r *Repository) Update(id uint, name, rawURL string) (*models.DashboardPanel, error) {
	panel, err := r.Get(id)
	if err != nil {
		return nil, err
	}
	var existing models.DashboardPanel
	err = r.db.Where("name = ? AND id <> ?", name, id).First(&existing).Error
	if err == nil {
		return nil, ErrNameConflict
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("check dashboard panel name: %w", err)
	}
	panel.Name = name
	panel.URL = rawURL
	if err := r.db.Save(panel).Error; err != nil {
		return nil, fmt.Errorf("update dashboard panel: %w", err)
	}
	return panel, nil
}

// List returns a page of panels in creation order and the total count.
func (r *Repository) List(page, pageSize int) ([]models.DashboardPanel, int64, error) {
	var total int64
	if err := r.db.Model(&models.DashboardPanel{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count dashboard panels: %w", err)
	}
	panels := make([]models.DashboardPanel, 0)
	offset := (page - 1) * pageSize
	if err := r.db.Order("created_at ASC, id ASC").Offset(offset).Limit(pageSize).Find(&panels).Error; err != nil {
		return nil, 0, fmt.Errorf("list dashboard panels: %w", err)
	}
	return panels, total, nil
}

// Get returns a panel by numeric ID.
func (r *Repository) Get(id uint) (*models.DashboardPanel, error) {
	var panel models.DashboardPanel
	if err := r.db.First(&panel, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPanelNotFound
		}
		return nil, fmt.Errorf("get dashboard panel: %w", err)
	}
	return &panel, nil
}
