package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// InstallationRepository persists exporter installation notes.
type InstallationRepository interface {
	Upsert(ctx context.Context, installation *domain.Installation) error
	Get(ctx context.Context, resourceID, jobID string) (*domain.Installation, error)
	ListByJob(ctx context.Context, jobID string) ([]*domain.Installation, error)
	Delete(ctx context.Context, resourceID, jobID string) error
}

// GORMInstallationRepository is the GORM-backed implementation.
type GORMInstallationRepository struct {
	db *gorm.DB
}

// NewInstallationRepository constructs the repository.
func NewInstallationRepository(db *gorm.DB) *GORMInstallationRepository {
	return &GORMInstallationRepository{db: db}
}

// Upsert inserts or replaces the note keyed by (resource_id, scrape_job_id).
func (r *GORMInstallationRepository) Upsert(ctx context.Context, installation *domain.Installation) error {
	existing, found, err := r.find(ctx, installation.ResourceID, installation.ScrapeJobID)
	if err != nil {
		return err
	}
	if found {
		installation.ID = existing.ID
		installation.CreatedAt = existing.CreatedAt
		rec := installationFromDomain(installation)
		rec.UpdatedAt = time.Now().UTC()
		res := r.db.WithContext(ctx).Model(&rec).
			Where("id = ?", rec.ID).
			Select("*").
			Omit("id", "created_at").
			Updates(&rec)
		if res.Error != nil {
			return res.Error
		}
		installation.UpdatedAt = rec.UpdatedAt
		return nil
	}
	if installation.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		installation.ID = id
	}
	rec := installationFromDomain(installation)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "installation", "resource_id/scrape_job_id", installation.ResourceID+"/"+installation.ScrapeJobID)
	}
	installation.CreatedAt, installation.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one installation note by natural key.
func (r *GORMInstallationRepository) Get(ctx context.Context, resourceID, jobID string) (*domain.Installation, error) {
	rec, found, err := r.find(ctx, resourceID, jobID)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, notFound("installation", resourceID+"/"+jobID)
	}
	return rec.toDomain(), nil
}

// ListByJob returns every installation note for one job.
func (r *GORMInstallationRepository) ListByJob(ctx context.Context, jobID string) ([]*domain.Installation, error) {
	var recs []installationRecord
	if err := r.db.WithContext(ctx).
		Where("scrape_job_id = ?", jobID).
		Order("resource_id ASC").
		Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Installation, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, nil
}

// Delete removes an installation note by natural key.
func (r *GORMInstallationRepository) Delete(ctx context.Context, resourceID, jobID string) error {
	res := r.db.WithContext(ctx).
		Where("resource_id = ? AND scrape_job_id = ?", resourceID, jobID).
		Delete(&installationRecord{})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("installation", resourceID+"/"+jobID)
	}
	return nil
}

func (r *GORMInstallationRepository) find(ctx context.Context, resourceID, jobID string) (installationRecord, bool, error) {
	var rec installationRecord
	err := r.db.WithContext(ctx).
		Where("resource_id = ? AND scrape_job_id = ?", resourceID, jobID).
		First(&rec).Error
	if isNotFound(err) {
		return installationRecord{}, false, nil
	}
	if err != nil {
		return installationRecord{}, false, err
	}
	return rec, true, nil
}
