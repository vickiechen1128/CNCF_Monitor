package repository

import (
	"context"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// JobGroupFilter filters job-group listings.
type JobGroupFilter struct {
	Status   domain.JobGroupStatus
	Keyword  string
	Page     int
	PageSize int
}

// JobGroupRepository persists monitoring intents (SRS JG v1.0 §7).
//
// A group never replaces the per-domain job row: child jobs keep every
// single-domain invariant M09 relies on, and only carry `job_group_id`.
type JobGroupRepository interface {
	Create(ctx context.Context, group *domain.JobGroup) error
	Get(ctx context.Context, id string) (*domain.JobGroup, error)
	List(ctx context.Context, filter JobGroupFilter) ([]*domain.JobGroup, int64, error)
	Update(ctx context.Context, group *domain.JobGroup) error
	SoftDelete(ctx context.Context, id string) error
	CountByName(ctx context.Context, name string) (int64, error)
	// Apply commits the group row and the child-job delta in one transaction.
	Apply(ctx context.Context, plan GroupPlan) error
	// ListJobsByGroup returns the live child jobs of a group.
	ListJobsByGroup(ctx context.Context, groupID string) ([]*domain.Job, error)
	// ListJobsByGroups batches child loading for list views (avoids N+1).
	ListJobsByGroups(ctx context.Context, groupIDs []string) (map[string][]*domain.Job, error)
}

// GORMJobGroupRepository is the GORM-backed implementation.
type GORMJobGroupRepository struct {
	db *gorm.DB
}

// NewJobGroupRepository constructs the repository.
func NewJobGroupRepository(db *gorm.DB) *GORMJobGroupRepository {
	return &GORMJobGroupRepository{db: db}
}

// Create inserts a job group.
func (r *GORMJobGroupRepository) Create(ctx context.Context, group *domain.JobGroup) error {
	if group.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		group.ID = id
	}
	rec := jobGroupFromDomain(group)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "job_group", "name", group.Name)
	}
	group.CreatedAt, group.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one job group by id.
func (r *GORMJobGroupRepository) Get(ctx context.Context, id string) (*domain.JobGroup, error) {
	var rec jobGroupRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("job_group", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of job groups.
func (r *GORMJobGroupRepository) List(ctx context.Context, filter JobGroupFilter) ([]*domain.JobGroup, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&jobGroupRecord{})
		if filter.Status != "" {
			q = q.Where("status = ?", string(filter.Status))
		}
		return keywordFilter(q, "name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []jobGroupRecord
	if err := paginate(build().Order("updated_at DESC, id ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.JobGroup, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, total, nil
}

// Update replaces mutable job-group fields.
func (r *GORMJobGroupRepository) Update(ctx context.Context, group *domain.JobGroup) error {
	rec := jobGroupFromDomain(group)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "job_group", "name", group.Name)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, group.ID); err != nil {
			return err
		}
	}
	group.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a job group as deleted. Child jobs are handled by the
// service layer (cascade within the same transaction).
func (r *GORMJobGroupRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&jobGroupRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("job_group", id)
	}
	return nil
}

// CountByName counts live groups with the given name (global unique per SRS JG v1.0).
func (r *GORMJobGroupRepository) CountByName(ctx context.Context, name string) (int64, error) {
	if name == "" {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&jobGroupRecord{}).
		Where("name = ?", name).Count(&count).Error
	return count, err
}

// jobGroupRecord maps m01_job_groups (00012).
type jobGroupRecord struct {
	ID                 string                   `gorm:"column:id;primaryKey"`
	Name               string                   `gorm:"column:name;not null"`
	JobType            string                   `gorm:"column:job_type;not null"`
	ResourceCategory   string                   `gorm:"column:resource_category;not null"`
	MonitorType        string                   `gorm:"column:monitor_type;not null"`
	ExporterTemplateID *string                  `gorm:"column:exporter_template_id"`
	ScrapeInterval     string                   `gorm:"column:scrape_interval;not null"`
	ScrapeTimeout      string                   `gorm:"column:scrape_timeout;not null"`
	MetricsPath        string                   `gorm:"column:metrics_path;not null"`
	Scheme             string                   `gorm:"column:scheme;not null"`
	AuthType           string                   `gorm:"column:auth_type;not null"`
	Username           string                   `gorm:"column:username;not null"`
	PasswordCipher     string                   `gorm:"column:password_cipher;not null"`
	TokenCipher        string                   `gorm:"column:token_cipher;not null"`
	TLSSkipVerify      bool                     `gorm:"column:tls_skip_verify;not null"`
	CAFile             string                   `gorm:"column:ca_file;not null"`
	LabelTemplateID    *string                  `gorm:"column:label_template_id"`
	BlackboxModule     *string                  `gorm:"column:blackbox_module"`
	TargetField        string                   `gorm:"column:target_field;not null"`
	MappingOverrides   []domain.MappingOverride `gorm:"column:mapping_overrides;serializer:json;not null"`
	Status             string                   `gorm:"column:status;not null"`
	CreatedBy          string                   `gorm:"column:created_by;not null"`
	CreatedAt          time.Time                `gorm:"column:created_at"`
	UpdatedAt          time.Time                `gorm:"column:updated_at"`
	DeletedAt          gorm.DeletedAt           `gorm:"column:deleted_at"`
}

func (jobGroupRecord) TableName() string { return "m01_job_groups" }

func (r jobGroupRecord) toDomain() *domain.JobGroup {
	return &domain.JobGroup{
		ID:                 r.ID,
		Name:               r.Name,
		JobType:            domain.JobType(r.JobType),
		ResourceCategory:   domain.ResourceCategory(r.ResourceCategory),
		MonitorType:        r.MonitorType,
		ExporterTemplateID: derefString(r.ExporterTemplateID),
		ScrapeInterval:     r.ScrapeInterval,
		ScrapeTimeout:      r.ScrapeTimeout,
		MetricsPath:        r.MetricsPath,
		Scheme:             domain.Scheme(r.Scheme),
		AuthType:           domain.AuthType(r.AuthType),
		Username:           r.Username,
		PasswordCipher:     r.PasswordCipher,
		TokenCipher:        r.TokenCipher,
		TLSSkipVerify:      r.TLSSkipVerify,
		CAFile:             r.CAFile,
		LabelTemplateID:    derefString(r.LabelTemplateID),
		BlackboxModule:     derefString(r.BlackboxModule),
		TargetField:        r.TargetField,
		MappingOverrides:   nonNilOverrides(r.MappingOverrides),
		Status:             domain.JobGroupStatus(r.Status),
		CreatedBy:          r.CreatedBy,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}
}

func jobGroupFromDomain(g *domain.JobGroup) jobGroupRecord {
	status := string(g.Status)
	if status == "" {
		status = string(domain.JobGroupStatusEnabled)
	}
	// CHECK 约束要求枚举列非空，仓储层补齐默认值，避免调用方漏填导致 500。
	jobType := string(g.JobType)
	if jobType == "" {
		jobType = string(domain.JobTypeStandard)
	}
	scheme := string(g.Scheme)
	if scheme == "" {
		scheme = string(domain.SchemeHTTP)
	}
	authType := string(g.AuthType)
	if authType == "" {
		authType = string(domain.AuthNone)
	}
	return jobGroupRecord{
		ID:                 g.ID,
		Name:               g.Name,
		JobType:            jobType,
		ResourceCategory:   string(g.ResourceCategory),
		MonitorType:        g.MonitorType,
		ExporterTemplateID: nilIfEmpty(g.ExporterTemplateID),
		ScrapeInterval:     g.ScrapeInterval,
		ScrapeTimeout:      g.ScrapeTimeout,
		MetricsPath:        g.MetricsPath,
		Scheme:             scheme,
		AuthType:           authType,
		Username:           g.Username,
		PasswordCipher:     g.PasswordCipher,
		TokenCipher:        g.TokenCipher,
		TLSSkipVerify:      g.TLSSkipVerify,
		CAFile:             g.CAFile,
		LabelTemplateID:    nilIfEmpty(g.LabelTemplateID),
		BlackboxModule:     nilIfEmpty(g.BlackboxModule),
		TargetField:        g.TargetField,
		MappingOverrides:   nonNilOverrides(g.MappingOverrides),
		Status:             status,
		CreatedBy:          g.CreatedBy,
	}
}

// GroupPlan is the atomic persistence unit for one job-group mutation: the
// group row plus the child-job delta, committed in a single transaction so a
// partially created group can never exist (SRS JG NFR-JG-01).
type GroupPlan struct {
	Group        *domain.JobGroup
	CreateGroup  bool
	UpdateGroup  bool
	DeleteGroup  bool
	JobsToCreate []*domain.Job
	JobsToUpdate []*domain.Job
	JobsToDelete []string
}

// Apply commits the plan in one transaction.
func (r *GORMJobGroupRepository) Apply(ctx context.Context, plan GroupPlan) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		if plan.CreateGroup {
			if plan.Group == nil {
				return domain.NewValidationError("job_group", "is required")
			}
			if plan.Group.ID == "" {
				id, err := domain.NewID()
				if err != nil {
					return err
				}
				plan.Group.ID = id
			}
			rec := jobGroupFromDomain(plan.Group)
			if err := tx.Create(&rec).Error; err != nil {
				return mapWriteError(err, "job_group", "name", plan.Group.Name)
			}
			plan.Group.CreatedAt, plan.Group.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
		}
		if plan.UpdateGroup {
			if plan.Group == nil {
				return domain.NewValidationError("job_group", "is required")
			}
			rec := jobGroupFromDomain(plan.Group)
			rec.UpdatedAt = now
			res := tx.Model(&rec).
				Where("id = ?", rec.ID).
				Select("*").
				Omit("id", "created_at", "deleted_at").
				Updates(&rec)
			if res.Error != nil {
				return mapWriteError(res.Error, "job_group", "name", plan.Group.Name)
			}
			if res.RowsAffected == 0 {
				return notFound("job_group", plan.Group.ID)
			}
			plan.Group.UpdatedAt = rec.UpdatedAt
		}
		for _, job := range plan.JobsToCreate {
			if job.ID == "" {
				id, err := domain.NewID()
				if err != nil {
					return err
				}
				job.ID = id
			}
			rec := jobFromDomain(job)
			if err := tx.Create(&rec).Error; err != nil {
				return mapWriteError(err, "scrape_job", "job_name", job.JobName)
			}
			job.CreatedAt, job.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
		}
		for _, job := range plan.JobsToUpdate {
			rec := jobFromDomain(job)
			rec.UpdatedAt = now
			res := tx.Model(&rec).
				Where("id = ?", rec.ID).
				Select("*").
				Omit("id", "created_at", "deleted_at").
				Updates(&rec)
			if res.Error != nil {
				return mapWriteError(res.Error, "scrape_job", "job_name", job.JobName)
			}
			if res.RowsAffected == 0 {
				return notFound("scrape_job", job.ID)
			}
			job.UpdatedAt = rec.UpdatedAt
		}
		if len(plan.JobsToDelete) > 0 {
			if err := tx.Delete(&jobRecord{}, "id IN ?", plan.JobsToDelete).Error; err != nil {
				return err
			}
		}
		if plan.DeleteGroup {
			if plan.Group == nil {
				return domain.NewValidationError("job_group", "is required")
			}
			if err := tx.Delete(&jobGroupRecord{}, "id = ?", plan.Group.ID).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ListJobsByGroup returns the live child jobs of a group, ordered by domain.
func (r *GORMJobGroupRepository) ListJobsByGroup(ctx context.Context, groupID string) ([]*domain.Job, error) {
	if strings.TrimSpace(groupID) == "" {
		return nil, nil
	}
	var recs []jobRecord
	if err := r.db.WithContext(ctx).
		Where("job_group_id = ?", groupID).
		Order("network_domain_id ASC").
		Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Job, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// ListJobsByGroups returns the live child jobs of several groups in one query,
// grouped by job_group_id (list views must not issue one query per group).
func (r *GORMJobGroupRepository) ListJobsByGroups(ctx context.Context, groupIDs []string) (map[string][]*domain.Job, error) {
	out := make(map[string][]*domain.Job, len(groupIDs))
	if len(groupIDs) == 0 {
		return out, nil
	}
	var recs []jobRecord
	if err := r.db.WithContext(ctx).
		Where("job_group_id IN ?", groupIDs).
		Order("network_domain_id ASC").
		Find(&recs).Error; err != nil {
		return nil, err
	}
	for i := range recs {
		groupID := derefString(recs[i].JobGroupID)
		out[groupID] = append(out[groupID], recs[i].toDomain())
	}
	return out, nil
}
