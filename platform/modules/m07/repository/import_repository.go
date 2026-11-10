package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"gorm.io/gorm"
)

type importRecordRecord struct {
	ID               string                      `gorm:"column:id;primaryKey"`
	ImportNo         string                      `gorm:"column:import_no;not null"`
	ResourceCategory string                      `gorm:"column:resource_category;not null"`
	Mode             string                      `gorm:"column:mode;not null"`
	Total            int                         `gorm:"column:total;not null"`
	Success          int                         `gorm:"column:success;not null"`
	Updated          int                         `gorm:"column:updated;not null"`
	Failed           int                         `gorm:"column:failed;not null"`
	Status           string                      `gorm:"column:status;not null"`
	Errors           []domain.ImportErrorDetail  `gorm:"column:errors_json;serializer:json"`
	Operator         string                      `gorm:"column:operator"`
	CreatedAt        time.Time                   `gorm:"column:created_at"`
}

func (importRecordRecord) TableName() string { return "import_records" }

// ImportRepository persists import job records.
type ImportRepository interface {
	Create(ctx context.Context, record *domain.ImportRecord) error
	List(ctx context.Context, category, status string) ([]*domain.ImportRecord, error)
	Get(ctx context.Context, importID string) (*domain.ImportRecord, error)
}

// GORMImportRepository is the GORM-backed ImportRepository.
type GORMImportRepository struct {
	db *gorm.DB
}

// NewGORMImportRepository constructs an import repository.
func NewGORMImportRepository(db *gorm.DB) *GORMImportRepository {
	return &GORMImportRepository{db: db}
}

func (r *GORMImportRepository) Create(ctx context.Context, record *domain.ImportRecord) error {
	if record.ID == "" {
		id, err := domain.NewResourceID()
		if err != nil {
			return err
		}
		record.ID = id
	}
	rec := &importRecordRecord{
		ID:               record.ID,
		ImportNo:         record.ImportNo,
		ResourceCategory: string(record.ResourceCategory),
		Mode:             string(record.Mode),
		Total:            record.Total,
		Success:          record.Success,
		Updated:          record.Updated,
		Failed:           record.Failed,
		Status:           string(record.Status),
		Errors:           record.Errors,
		Operator:         record.Operator,
	}
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return fmt.Errorf("create import record: %w", err)
	}
	record.CreatedAt = rec.CreatedAt
	return nil
}

func (r *GORMImportRepository) List(ctx context.Context, category, status string) ([]*domain.ImportRecord, error) {
	q := r.db.WithContext(ctx).Model(&importRecordRecord{})
	if category != "" {
		q = q.Where("resource_category = ?", category)
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	var rows []importRecordRecord
	if err := q.Order("created_at DESC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list import records: %w", err)
	}
	out := make([]*domain.ImportRecord, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainImportRecord(&rows[i]))
	}
	return out, nil
}

func (r *GORMImportRepository) Get(ctx context.Context, importID string) (*domain.ImportRecord, error) {
	var rec importRecordRecord
	err := r.db.WithContext(ctx).Where("id = ? OR import_no = ?", importID, importID).First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &domain.NotFoundError{ResourceID: importID}
	}
	if err != nil {
		return nil, fmt.Errorf("get import record %s: %w", importID, err)
	}
	return toDomainImportRecord(&rec), nil
}

func toDomainImportRecord(rec *importRecordRecord) *domain.ImportRecord {
	return &domain.ImportRecord{
		ID:               rec.ID,
		ImportNo:         rec.ImportNo,
		ResourceCategory: domain.Category(rec.ResourceCategory),
		Mode:             domain.ImportMode(rec.Mode),
		Total:            rec.Total,
		Success:          rec.Success,
		Updated:          rec.Updated,
		Failed:           rec.Failed,
		Status:           domain.ImportStatus(rec.Status),
		Errors:           rec.Errors,
		Operator:         rec.Operator,
		CreatedAt:        rec.CreatedAt,
	}
}
