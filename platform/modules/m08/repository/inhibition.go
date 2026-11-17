package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// InhibitionFilter filters inhibition-rule listings (D49 search).
type InhibitionFilter struct {
	Keyword  string
	Enabled  *bool
	Page     int
	PageSize int
}

// InhibitionRepository persists inhibition rules.
type InhibitionRepository interface {
	Create(ctx context.Context, rule *domain.InhibitionRule) error
	Get(ctx context.Context, id string) (*domain.InhibitionRule, error)
	List(ctx context.Context, filter InhibitionFilter) ([]*domain.InhibitionRule, int64, error)
	Update(ctx context.Context, rule *domain.InhibitionRule) error
	SoftDelete(ctx context.Context, id string) error
	ListEnabled(ctx context.Context) ([]*domain.InhibitionRule, error)
}

// GORMInhibitionRepository is the GORM-backed implementation.
type GORMInhibitionRepository struct{ db *gorm.DB }

// NewInhibitionRepository constructs the repository.
func NewInhibitionRepository(db *gorm.DB) *GORMInhibitionRepository {
	return &GORMInhibitionRepository{db: db}
}

// Create inserts a rule.
func (r *GORMInhibitionRepository) Create(ctx context.Context, rule *domain.InhibitionRule) error {
	if rule.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		rule.ID = id
	}
	if err := r.db.WithContext(ctx).Create(inhibitionFromDomain(rule)).Error; err != nil {
		return mapWriteError(err, "inhibition_rule", "name", rule.Name)
	}
	return nil
}

// Get loads one rule.
func (r *GORMInhibitionRepository) Get(ctx context.Context, id string) (*domain.InhibitionRule, error) {
	var rec inhibitionRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("inhibition rule", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of rules; keyword matches name and matcher payloads.
func (r *GORMInhibitionRepository) List(ctx context.Context, filter InhibitionFilter) ([]*domain.InhibitionRule, int64, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&inhibitionRecord{})
		if filter.Enabled != nil {
			q = q.Where("enabled = ?", *filter.Enabled)
		}
		return keywordLike(q, filter.Keyword, "name", "source_matchers", "target_matchers")
	}
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []inhibitionRecord
	if err := paginate(build().Order("builtin DESC, updated_at DESC, id ASC"), page, pageSize).
		Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.InhibitionRule, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, total, nil
}

// Update replaces rule fields.
func (r *GORMInhibitionRepository) Update(ctx context.Context, rule *domain.InhibitionRule) error {
	source, err := json.Marshal(rule.SourceMatchers)
	if err != nil {
		return fmt.Errorf("encode source matchers: %w", err)
	}
	target, err := json.Marshal(rule.TargetMatchers)
	if err != nil {
		return fmt.Errorf("encode target matchers: %w", err)
	}
	equal, err := json.Marshal(rule.Equal)
	if err != nil {
		return fmt.Errorf("encode equal labels: %w", err)
	}
	res := r.db.WithContext(ctx).Model(&inhibitionRecord{}).Where("id = ?", rule.ID).
		Updates(map[string]any{
			"name": rule.Name, "source_matchers": string(source),
			"target_matchers": string(target), "equal": string(equal),
			"enabled": rule.Enabled, "updated_at": time.Now().UTC(),
		})
	if res.Error != nil {
		return mapWriteError(res.Error, "inhibition_rule", "name", rule.Name)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, rule.ID); err != nil {
			return err
		}
	}
	return nil
}

// SoftDelete marks a rule as deleted.
func (r *GORMInhibitionRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&inhibitionRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("inhibition rule", id)
	}
	return nil
}

// ListEnabled returns every enabled rule for rendering.
func (r *GORMInhibitionRepository) ListEnabled(ctx context.Context) ([]*domain.InhibitionRule, error) {
	var recs []inhibitionRecord
	if err := r.db.WithContext(ctx).Where("enabled = ?", true).
		Order("builtin DESC, name ASC").Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.InhibitionRule, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// AuditFilter filters silence-audit listings (D50).
type AuditFilter struct {
	Operator  string
	Action    string
	SilenceID string
	From      *time.Time
	To        *time.Time
	Page      int
	PageSize  int
}

// AuditRepository persists silence audit rows (append-only).
type AuditRepository interface {
	Insert(ctx context.Context, entry *AuditEntry) error
	List(ctx context.Context, filter AuditFilter) ([]*AuditEntry, int64, error)
}

// AuditEntry is one silence audit row.
type AuditEntry struct {
	ID            int64
	Action        domain.AuditAction
	Result        domain.AuditResult
	Operator      string
	SilenceID     string
	Matchers      []domain.Matcher
	Reason        string
	FailureReason string
	At            time.Time
}

// GORMAuditRepository is the GORM-backed implementation.
type GORMAuditRepository struct{ db *gorm.DB }

// NewAuditRepository constructs the repository.
func NewAuditRepository(db *gorm.DB) *GORMAuditRepository { return &GORMAuditRepository{db: db} }

// Insert appends one audit row.
func (r *GORMAuditRepository) Insert(ctx context.Context, entry *AuditEntry) error {
	rec := &auditRecord{
		Action: string(entry.Action), Result: string(entry.Result), Operator: entry.Operator,
		SilenceID: entry.SilenceID, Matchers: entry.Matchers, Reason: entry.Reason,
		FailureReason: entry.FailureReason, At: entry.At,
	}
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return err
	}
	entry.ID, entry.At = rec.ID, rec.At
	return nil
}

// List returns a page of audit rows, newest first.
func (r *GORMAuditRepository) List(ctx context.Context, filter AuditFilter) ([]*AuditEntry, int64, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&auditRecord{})
		if filter.Operator != "" {
			q = q.Where("operator = ?", filter.Operator)
		}
		if filter.Action != "" {
			q = q.Where("action = ?", filter.Action)
		}
		if filter.SilenceID != "" {
			q = q.Where("silence_id = ?", filter.SilenceID)
		}
		if filter.From != nil {
			q = q.Where("at >= ?", *filter.From)
		}
		if filter.To != nil {
			q = q.Where("at <= ?", *filter.To)
		}
		return q
	}
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []auditRecord
	if err := paginate(build().Order("id DESC"), page, pageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*AuditEntry, 0, len(recs))
	for i := range recs {
		rec := recs[i]
		out = append(out, &AuditEntry{
			ID: rec.ID, Action: domain.AuditAction(rec.Action),
			Result: domain.AuditResult(rec.Result), Operator: rec.Operator,
			SilenceID: rec.SilenceID, Matchers: rec.Matchers, Reason: rec.Reason,
			FailureReason: rec.FailureReason, At: rec.At,
		})
	}
	return out, total, nil
}
