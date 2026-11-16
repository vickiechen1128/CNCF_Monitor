package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// RuleFilter filters monitoring rule listings.
type RuleFilter struct {
	Enabled     *bool
	DraftStatus domain.DraftStatus
	MonitorType string
	Keyword     string
	Page        int
	PageSize    int
}

// RuleRepository persists monitoring rules.
type RuleRepository interface {
	Create(ctx context.Context, rule *domain.Rule) error
	Get(ctx context.Context, id string) (*domain.Rule, error)
	List(ctx context.Context, filter RuleFilter) ([]*domain.Rule, int64, error)
	Update(ctx context.Context, rule *domain.Rule) error
	SoftDelete(ctx context.Context, id string) error
	ListEnabledReady(ctx context.Context) ([]*domain.Rule, error)
}

// GORMRuleRepository is the GORM-backed implementation.
type GORMRuleRepository struct {
	db *gorm.DB
}

// NewRuleRepository constructs the repository.
func NewRuleRepository(db *gorm.DB) *GORMRuleRepository {
	return &GORMRuleRepository{db: db}
}

// Create inserts a monitoring rule.
func (r *GORMRuleRepository) Create(ctx context.Context, rule *domain.Rule) error {
	if rule.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		rule.ID = id
	}
	rec := ruleFromDomain(rule)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "monitoring_rule", "id", rule.ID)
	}
	rule.CreatedAt, rule.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one monitoring rule by id.
func (r *GORMRuleRepository) Get(ctx context.Context, id string) (*domain.Rule, error) {
	var rec ruleRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("monitoring_rule", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of monitoring rules.
func (r *GORMRuleRepository) List(ctx context.Context, filter RuleFilter) ([]*domain.Rule, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&ruleRecord{})
		if filter.Enabled != nil {
			q = q.Where("enabled = ?", *filter.Enabled)
		}
		if filter.DraftStatus != "" {
			q = q.Where("draft_status = ?", string(filter.DraftStatus))
		}
		if filter.MonitorType != "" {
			q = q.Where("monitor_type = ?", filter.MonitorType)
		}
		return keywordFilter(q, "name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []ruleRecord
	if err := paginate(build().Order("updated_at DESC, id ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Rule, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable monitoring rule fields.
func (r *GORMRuleRepository) Update(ctx context.Context, rule *domain.Rule) error {
	rec := ruleFromDomain(rule)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "monitoring_rule", "id", rule.ID)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, rule.ID); err != nil {
			return err
		}
	}
	rule.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a monitoring rule as deleted.
func (r *GORMRuleRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&ruleRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("monitoring_rule", id)
	}
	return nil
}

// ListEnabledReady returns rules that participate in center-side generation
// (enabled && draft_status=ready), ordered for deterministic rendering.
func (r *GORMRuleRepository) ListEnabledReady(ctx context.Context) ([]*domain.Rule, error) {
	var recs []ruleRecord
	if err := r.db.WithContext(ctx).
		Where("enabled = ? AND draft_status = ?", true, string(domain.DraftStatusReady)).
		Order("updated_at ASC, id ASC").
		Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Rule, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, nil
}
