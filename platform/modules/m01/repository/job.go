package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// JobFilter filters scrape job listings.
type JobFilter struct {
	NetworkDomainID string
	// Ungrouped limits the result to jobs without a monitoring-intent group
	// (job_group_id IS NULL); used by the merged task list's "未分组" section.
	Ungrouped bool
	// GroupedOnly is the symmetric filter (job_group_id IS NOT NULL): callers
	// that count "grouped execution jobs" must not accidentally include
	// standalone jobs（口径显式化）。
	GroupedOnly     bool
	MonitorType     string
	JobType         domain.JobType
	Enabled         *bool
	DraftStatus     domain.DraftStatus
	LabelTemplateID string
	Keyword         string
	Page            int
	PageSize        int
}

// JobRepository persists scrape jobs.
type JobRepository interface {
	Create(ctx context.Context, job *domain.Job) error
	Get(ctx context.Context, id string) (*domain.Job, error)
	List(ctx context.Context, filter JobFilter) ([]*domain.Job, int64, error)
	Update(ctx context.Context, job *domain.Job) error
	SoftDelete(ctx context.Context, id string) error
	CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error)
	CountByNetworkDomain(ctx context.Context, domainID string) (int64, error)
	CountByProbeModule(ctx context.Context, name string) (int64, error)
	CountByMapping(ctx context.Context, monitorType, exporterTemplateID string) (int64, error)
	ListActiveNames(ctx context.Context) ([]string, error)
	ListAll(ctx context.Context) ([]*domain.Job, error)
}

// GORMJobRepository is the GORM-backed implementation.
type GORMJobRepository struct {
	db *gorm.DB
}

// NewJobRepository constructs the repository.
func NewJobRepository(db *gorm.DB) *GORMJobRepository {
	return &GORMJobRepository{db: db}
}

// Create inserts a scrape job.
func (r *GORMJobRepository) Create(ctx context.Context, job *domain.Job) error {
	if job.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		job.ID = id
	}
	rec := jobFromDomain(job)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "scrape_job", "job_name", job.JobName)
	}
	job.CreatedAt, job.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one scrape job by id.
func (r *GORMJobRepository) Get(ctx context.Context, id string) (*domain.Job, error) {
	var rec jobRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("scrape_job", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of scrape jobs.
func (r *GORMJobRepository) List(ctx context.Context, filter JobFilter) ([]*domain.Job, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&jobRecord{})
		if filter.NetworkDomainID != "" {
			q = q.Where("network_domain_id = ?", filter.NetworkDomainID)
		}
		if filter.Ungrouped {
			q = q.Where("job_group_id IS NULL")
		}
		if filter.GroupedOnly {
			q = q.Where("job_group_id IS NOT NULL")
		}
		if filter.MonitorType != "" {
			q = q.Where("monitor_type = ?", filter.MonitorType)
		}
		if filter.JobType != "" {
			q = q.Where("job_type = ?", string(filter.JobType))
		}
		if filter.Enabled != nil {
			q = q.Where("enabled = ?", *filter.Enabled)
		}
		if filter.DraftStatus != "" {
			q = q.Where("draft_status = ?", string(filter.DraftStatus))
		}
		if filter.LabelTemplateID != "" {
			q = q.Where("label_template_id = ?", filter.LabelTemplateID)
		}
		return keywordFilter(q, "job_name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []jobRecord
	if err := paginate(build().Order("updated_at DESC, id ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Job, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable scrape job fields.
func (r *GORMJobRepository) Update(ctx context.Context, job *domain.Job) error {
	rec := jobFromDomain(job)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "scrape_job", "job_name", job.JobName)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, job.ID); err != nil {
			return err
		}
	}
	job.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a scrape job as deleted.
func (r *GORMJobRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&jobRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("scrape_job", id)
	}
	return nil
}

// CountByLabelTemplate counts jobs that reference a label template.
func (r *GORMJobRepository) CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error) {
	if labelTemplateID == "" {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("label_template_id = ?", labelTemplateID).Count(&count).Error
	return count, err
}

// CountByNetworkDomain counts jobs bound to a network domain.
func (r *GORMJobRepository) CountByNetworkDomain(ctx context.Context, domainID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("network_domain_id = ?", domainID).Count(&count).Error
	return count, err
}

// ListAll returns every live job (used by the D40 reconciliation loop).
func (r *GORMJobRepository) ListAll(ctx context.Context) ([]*domain.Job, error) {
	var recs []jobRecord
	if err := r.db.WithContext(ctx).Order("job_name ASC").Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Job, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, nil
}

// CountByMapping counts jobs that inherited a mapping (same monitor type and
// exporter implementation). Used to protect mapping deletion.
func (r *GORMJobRepository) CountByMapping(ctx context.Context, monitorType, exporterTemplateID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("monitor_type = ? AND exporter_template_id = ?", monitorType, exporterTemplateID).
		Count(&count).Error
	return count, err
}

// ListActiveNames returns ready+enabled job names (the rule job-reference set).
func (r *GORMJobRepository) ListActiveNames(ctx context.Context) ([]string, error) {
	var names []string
	err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("draft_status = ? AND enabled = ?", string(domain.DraftStatusReady), true).
		Order("job_name ASC").Pluck("job_name", &names).Error
	return names, err
}

// CountByProbeModule counts jobs that reference a blackbox module by name.
func (r *GORMJobRepository) CountByProbeModule(ctx context.Context, name string) (int64, error) {
	if name == "" {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("blackbox_module = ?", name).Count(&count).Error
	return count, err
}
