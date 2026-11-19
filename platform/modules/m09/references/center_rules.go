package references

import (
	"context"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// CenterRule is one ready M01 rule consumed by the center evaluator (D35).
type CenterRule struct {
	ID          string
	Name        string
	RuleContent string
}

// CenterRuleSource reads platform-global rules from M01 and reports changes.
type CenterRuleSource interface {
	ListEnabledReady(ctx context.Context) ([]CenterRule, error)
	Fingerprint(ctx context.Context) (time.Time, error)
	// EffectiveJobNames returns the global enabled+ready job-name union used by
	// the center rule job-reference gate (decision 66). Rules are evaluated
	// centrally, so references may span every network domain.
	EffectiveJobNames(ctx context.Context) ([]string, error)
}

// GORMCenterRuleSource is the GORM-backed implementation.
type GORMCenterRuleSource struct {
	db *gorm.DB
}

// NewCenterRuleSource constructs the reader.
func NewCenterRuleSource(db *gorm.DB) *GORMCenterRuleSource {
	return &GORMCenterRuleSource{db: db}
}

type centerRuleRow struct {
	ID          string `gorm:"column:id"`
	Name        string `gorm:"column:name"`
	RuleContent string `gorm:"column:rule_content"`
}

// ListEnabledReady returns rules that participate in center evaluation.
func (r *GORMCenterRuleSource) ListEnabledReady(ctx context.Context) ([]CenterRule, error) {
	var rows []centerRuleRow
	if err := r.db.WithContext(ctx).
		Table("m01_monitoring_rules").
		Select("id, name, rule_content").
		Where("enabled = ? AND draft_status = ? AND deleted_at IS NULL", true, "ready").
		Order("id ASC").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("load center rules: %w", err)
	}
	out := make([]CenterRule, 0, len(rows))
	for _, row := range rows {
		out = append(out, CenterRule{ID: row.ID, Name: row.Name, RuleContent: row.RuleContent})
	}
	return out, nil
}

// EffectiveJobNames returns every enabled, ready job name across all network
// domains. Center rules are evaluated by one Prometheus, so the job-reference
// gate must see the global union rather than a single domain package.
func (r *GORMCenterRuleSource) EffectiveJobNames(ctx context.Context) ([]string, error) {
	var names []string
	if err := r.db.WithContext(ctx).
		Table("m01_scrape_jobs").
		Where("enabled = ? AND draft_status = ? AND deleted_at IS NULL", true, "ready").
		Order("job_name ASC").
		Pluck("job_name", &names).Error; err != nil {
		return nil, fmt.Errorf("list effective center rule jobs: %w", err)
	}
	return names, nil
}

// Fingerprint returns the newest rule change (including soft deletions).
func (r *GORMCenterRuleSource) Fingerprint(ctx context.Context) (time.Time, error) {
	queries := []struct {
		column string
		where  string
	}{
		{"updated_at", "deleted_at IS NULL"},
		{"deleted_at", "deleted_at IS NOT NULL"},
	}
	var newest time.Time
	for _, q := range queries {
		var row struct {
			Value *time.Time `gorm:"column:value"`
		}
		if err := r.db.WithContext(ctx).
			Table("m01_monitoring_rules").
			Select(q.column + " AS value").
			Where(q.where).
			Order(q.column + " DESC").
			Limit(1).
			Scan(&row).Error; err != nil {
			return time.Time{}, fmt.Errorf("center rules fingerprint: %w", err)
		}
		if row.Value != nil && row.Value.After(newest) {
			newest = *row.Value
		}
	}
	return newest.UTC(), nil
}
