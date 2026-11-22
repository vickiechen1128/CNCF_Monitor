package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
)

// PanelRepository persists the mounted Grafana panels (m05_dashboard_panels).
type PanelRepository interface {
	// List returns one page ordered by updated_at DESC, id DESC plus the total.
	List(ctx context.Context, page, pageSize int) ([]domain.Panel, int64, error)
	// Get returns one panel; found=false when the ID does not exist.
	Get(ctx context.Context, id uint) (domain.Panel, bool, error)
	// Create inserts a panel (the unique name index backstops the service check).
	Create(ctx context.Context, input domain.CreatePanelInput) (domain.Panel, error)
	// Update rewrites name / url of an existing panel, keeping id / created_at.
	Update(ctx context.Context, id uint, input domain.UpdatePanelInput) (domain.Panel, bool, error)
	// ExistsByName reports whether another panel already uses name (exceptID=0
	// means "any panel").
	ExistsByName(ctx context.Context, name string, exceptID uint) (bool, error)
}

// panelRecord maps m05_dashboard_panels (00010 migration).
type panelRecord struct {
	ID        uint      `gorm:"column:id;primaryKey"`
	Name      string    `gorm:"column:name;not null"`
	URL       string    `gorm:"column:url;not null"`
	CreatedAt time.Time `gorm:"column:created_at"`
	UpdatedAt time.Time `gorm:"column:updated_at"`
}

// TableName pins the migrated table name.
func (panelRecord) TableName() string { return "m05_dashboard_panels" }

func (r panelRecord) toDomain() domain.Panel {
	return domain.Panel{
		ID:   r.ID,
		Name: r.Name,
		URL:  r.URL,
		// Normalise to UTC: PostgreSQL TIMESTAMP columns scan back as UTC, while
		// an in-memory row created by GORM keeps the local zone. Returning both
		// shapes for the same field made created_at "change" after an update.
		CreatedAt: r.CreatedAt.UTC(),
		UpdatedAt: r.UpdatedAt.UTC(),
	}
}

// GORMPanelRepository is the GORM-backed PanelRepository.
type GORMPanelRepository struct {
	db *gorm.DB
}

// NewGORMPanelRepository constructs the panel repository.
func NewGORMPanelRepository(db *gorm.DB) *GORMPanelRepository {
	return &GORMPanelRepository{db: db}
}

// List implements PanelRepository.
func (r *GORMPanelRepository) List(ctx context.Context, page, pageSize int) ([]domain.Panel, int64, error) {
	var total int64
	if err := r.db.WithContext(ctx).Model(&panelRecord{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count dashboard panels: %w", err)
	}
	var rows []panelRecord
	offset := (page - 1) * pageSize
	if err := r.db.WithContext(ctx).
		Order("updated_at DESC, id DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list dashboard panels: %w", err)
	}
	panels := make([]domain.Panel, 0, len(rows))
	for _, row := range rows {
		panels = append(panels, row.toDomain())
	}
	return panels, total, nil
}

// Get implements PanelRepository.
func (r *GORMPanelRepository) Get(ctx context.Context, id uint) (domain.Panel, bool, error) {
	var row panelRecord
	err := r.db.WithContext(ctx).First(&row, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Panel{}, false, nil
	}
	if err != nil {
		return domain.Panel{}, false, fmt.Errorf("get dashboard panel %d: %w", id, err)
	}
	return row.toDomain(), true, nil
}

// Create implements PanelRepository.
func (r *GORMPanelRepository) Create(ctx context.Context, input domain.CreatePanelInput) (domain.Panel, error) {
	row := panelRecord{Name: input.Name, URL: input.URL}
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		// The service pre-checks the name; a concurrent create can still race
		// the unique index, which must map to 409 instead of 500.
		if isUniqueViolation(err) {
			return domain.Panel{}, domain.ErrNameTaken
		}
		return domain.Panel{}, fmt.Errorf("create dashboard panel %q: %w", input.Name, err)
	}
	return row.toDomain(), nil
}

// Update implements PanelRepository.
func (r *GORMPanelRepository) Update(ctx context.Context, id uint, input domain.UpdatePanelInput) (domain.Panel, bool, error) {
	var row panelRecord
	err := r.db.WithContext(ctx).First(&row, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return domain.Panel{}, false, nil
	}
	if err != nil {
		return domain.Panel{}, false, fmt.Errorf("get dashboard panel %d: %w", id, err)
	}
	row.Name = input.Name
	row.URL = input.URL
	if err := r.db.WithContext(ctx).Save(&row).Error; err != nil {
		if isUniqueViolation(err) {
			return domain.Panel{}, false, domain.ErrNameTaken
		}
		return domain.Panel{}, false, fmt.Errorf("update dashboard panel %d: %w", id, err)
	}
	return row.toDomain(), true, nil
}

// ExistsByName implements PanelRepository.
func (r *GORMPanelRepository) ExistsByName(ctx context.Context, name string, exceptID uint) (bool, error) {
	query := r.db.WithContext(ctx).Model(&panelRecord{}).Where("name = ?", name)
	if exceptID != 0 {
		query = query.Where("id <> ?", exceptID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, fmt.Errorf("check dashboard panel name %q: %w", name, err)
	}
	return count > 0, nil
}

// isUniqueViolation detects a unique-index violation on PostgreSQL.
func isUniqueViolation(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "duplicate key")
}
