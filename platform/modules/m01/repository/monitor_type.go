package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// monitorTypeRecord maps m01_monitor_types.
type monitorTypeRecord struct {
	Code             string         `gorm:"column:code;primaryKey"`
	Name             string         `gorm:"column:name;not null"`
	ResourceCategory string         `gorm:"column:resource_category;not null"`
	RuleLogic        string         `gorm:"column:rule_logic;not null"`
	Description      string         `gorm:"column:description;not null"`
	Icon             string         `gorm:"column:icon;not null"`
	Color            string         `gorm:"column:color;not null"`
	SortOrder        int            `gorm:"column:sort_order;not null"`
	Enabled          bool           `gorm:"column:enabled;not null"`
	IsBuiltin        bool           `gorm:"column:is_builtin;not null"`
	CreatedAt        time.Time      `gorm:"column:created_at"`
	UpdatedAt        time.Time      `gorm:"column:updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (monitorTypeRecord) TableName() string { return "m01_monitor_types" }

func (r monitorTypeRecord) toDomain() domain.MonitorTypeDefinition {
	return domain.MonitorTypeDefinition{
		Code:             r.Code,
		Name:             r.Name,
		ResourceCategory: domain.ResourceCategory(r.ResourceCategory),
		RuleLogic:        domain.RuleLogic(r.RuleLogic),
		Description:      r.Description,
		Icon:             r.Icon,
		Color:            r.Color,
		SortOrder:        r.SortOrder,
		Enabled:          r.Enabled,
		IsBuiltin:        r.IsBuiltin,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
}

func monitorTypeFromDomain(def domain.MonitorTypeDefinition) monitorTypeRecord {
	logic := def.RuleLogic
	if logic == "" {
		logic = domain.RuleLogicAll
	}
	return monitorTypeRecord{
		Code:             def.Code,
		Name:             def.Name,
		ResourceCategory: string(def.ResourceCategory),
		RuleLogic:        string(logic),
		Description:      def.Description,
		Icon:             def.Icon,
		Color:            def.Color,
		SortOrder:        def.SortOrder,
		Enabled:          def.Enabled,
		IsBuiltin:        def.IsBuiltin,
	}
}

// monitorTypeRuleRecord maps m01_monitor_type_rules.
type monitorTypeRuleRecord struct {
	ID              string         `gorm:"column:id;primaryKey"`
	MonitorTypeCode string         `gorm:"column:monitor_type_code;not null"`
	FieldName       string         `gorm:"column:field_name;not null"`
	MatchOperator   string         `gorm:"column:match_operator;not null"`
	FieldValues     []string       `gorm:"column:field_values;serializer:json;not null"`
	Priority        int            `gorm:"column:priority;not null"`
	CreatedAt       time.Time      `gorm:"column:created_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (monitorTypeRuleRecord) TableName() string { return "m01_monitor_type_rules" }

func (r monitorTypeRuleRecord) toDomain() domain.MonitorTypeRule {
	return domain.MonitorTypeRule{
		ID:              r.ID,
		MonitorTypeCode: r.MonitorTypeCode,
		Field:           r.FieldName,
		Operator:        domain.RuleOperator(r.MatchOperator),
		Values:          nonNilStrings(r.FieldValues),
		Priority:        r.Priority,
		CreatedAt:       r.CreatedAt,
		UpdatedAt:       r.UpdatedAt,
	}
}

func monitorTypeRuleFromDomain(rule domain.MonitorTypeRule) monitorTypeRuleRecord {
	return monitorTypeRuleRecord{
		ID:              rule.ID,
		MonitorTypeCode: rule.MonitorTypeCode,
		FieldName:       rule.Field,
		MatchOperator:   string(rule.Operator),
		FieldValues:     nonNilStrings(rule.Values),
		Priority:        rule.Priority,
	}
}

// MonitorTypeRepository persists the configurable monitor type registry.
type MonitorTypeRepository interface {
	// List returns every live definition with its rules, ordered for display.
	List(ctx context.Context) ([]domain.MonitorTypeEntry, error)
	// Get loads one definition and its rules.
	Get(ctx context.Context, code string) (domain.MonitorTypeEntry, bool, error)
	// Create inserts a definition together with its rules.
	Create(ctx context.Context, entry domain.MonitorTypeEntry) error
	// Update replaces the mutable definition fields (rules are replaced
	// separately through ReplaceRules).
	Update(ctx context.Context, definition domain.MonitorTypeDefinition) error
	// ReplaceRules swaps the whole rule set of a type in one transaction.
	ReplaceRules(ctx context.Context, code string, rules []domain.MonitorTypeRule) error
	// SoftDelete marks a definition as deleted.
	SoftDelete(ctx context.Context, code string) error
	// CountReferences counts rows that still reference a type. Deleting a
	// referenced type is refused (FR-24).
	CountReferences(ctx context.Context, code string) (MonitorTypeReferenceCounts, error)
}

// MonitorTypeReferenceCounts is the reference breakdown returned by delete
// pre-flight and by the change-impact preview (FR-24).
type MonitorTypeReferenceCounts struct {
	Mappings      int64 `json:"mappings"`
	Jobs          int64 `json:"jobs"`
	Rules         int64 `json:"rules"`
	MetricAnchors int64 `json:"metric_anchors"`
}

// Total sums every reference class.
func (c MonitorTypeReferenceCounts) Total() int64 {
	return c.Mappings + c.Jobs + c.Rules + c.MetricAnchors
}

// GORMMonitorTypeRepository is the GORM-backed implementation.
type GORMMonitorTypeRepository struct {
	db *gorm.DB
}

// NewMonitorTypeRepository constructs the repository.
func NewMonitorTypeRepository(db *gorm.DB) *GORMMonitorTypeRepository {
	return &GORMMonitorTypeRepository{db: db}
}

// List returns every live definition with its rules.
func (r *GORMMonitorTypeRepository) List(ctx context.Context) ([]domain.MonitorTypeEntry, error) {
	var defs []monitorTypeRecord
	if err := r.db.WithContext(ctx).
		Order("resource_category ASC, sort_order ASC, code ASC").
		Find(&defs).Error; err != nil {
		return nil, fmt.Errorf("list monitor types: %w", err)
	}
	if len(defs) == 0 {
		return []domain.MonitorTypeEntry{}, nil
	}
	rulesByCode, err := r.rulesByCode(ctx, nil)
	if err != nil {
		return nil, err
	}
	out := make([]domain.MonitorTypeEntry, 0, len(defs))
	for _, def := range defs {
		out = append(out, domain.MonitorTypeEntry{
			Definition: def.toDomain(),
			Rules:      rulesByCode[def.Code],
		})
	}
	return out, nil
}

// Get loads one definition and its rules.
func (r *GORMMonitorTypeRepository) Get(ctx context.Context, code string) (domain.MonitorTypeEntry, bool, error) {
	var def monitorTypeRecord
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&def).Error
	if isNotFound(err) {
		return domain.MonitorTypeEntry{}, false, nil
	}
	if err != nil {
		return domain.MonitorTypeEntry{}, false, fmt.Errorf("get monitor type %q: %w", code, err)
	}
	rulesByCode, err := r.rulesByCode(ctx, []string{code})
	if err != nil {
		return domain.MonitorTypeEntry{}, false, err
	}
	return domain.MonitorTypeEntry{Definition: def.toDomain(), Rules: rulesByCode[code]}, true, nil
}

// Create inserts a definition together with its rules.
func (r *GORMMonitorTypeRepository) Create(ctx context.Context, entry domain.MonitorTypeEntry) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rec := monitorTypeFromDomain(entry.Definition)
		if err := tx.Create(&rec).Error; err != nil {
			return mapWriteError(err, "monitor_type", "code", entry.Definition.Code)
		}
		for _, rule := range entry.Rules {
			ruleRec := monitorTypeRuleFromDomain(rule)
			if ruleRec.ID == "" {
				id, err := domain.NewID()
				if err != nil {
					return err
				}
				ruleRec.ID = id
			}
			if err := tx.Create(&ruleRec).Error; err != nil {
				return fmt.Errorf("create monitor type rule: %w", err)
			}
		}
		return nil
	})
}

// Update replaces the mutable definition fields.
func (r *GORMMonitorTypeRepository) Update(ctx context.Context, definition domain.MonitorTypeDefinition) error {
	rec := monitorTypeFromDomain(definition)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&monitorTypeRecord{}).
		Where("code = ?", definition.Code).
		Select("name", "resource_category", "rule_logic", "description", "icon", "color",
			"sort_order", "enabled", "updated_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "monitor_type", "code", definition.Code)
	}
	if res.RowsAffected == 0 {
		if _, found, err := r.Get(ctx, definition.Code); err != nil {
			return err
		} else if !found {
			return notFound("monitor_type", definition.Code)
		}
	}
	return nil
}

// ReplaceRules swaps the whole rule set of a type in one transaction.
func (r *GORMMonitorTypeRepository) ReplaceRules(ctx context.Context, code string, rules []domain.MonitorTypeRule) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Where("monitor_type_code = ?", code).
			Delete(&monitorTypeRuleRecord{}).Error; err != nil {
			return fmt.Errorf("clear monitor type rules: %w", err)
		}
		for _, rule := range rules {
			rec := monitorTypeRuleFromDomain(rule)
			rec.MonitorTypeCode = code
			if rec.ID == "" {
				id, err := domain.NewID()
				if err != nil {
					return err
				}
				rec.ID = id
			}
			if err := tx.Create(&rec).Error; err != nil {
				return fmt.Errorf("create monitor type rule: %w", err)
			}
		}
		return nil
	})
}

// SoftDelete marks a definition as deleted.
func (r *GORMMonitorTypeRepository) SoftDelete(ctx context.Context, code string) error {
	res := r.db.WithContext(ctx).Delete(&monitorTypeRecord{}, "code = ?", code)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("monitor_type", code)
	}
	return nil
}

// CountReferences counts the rows still pointing at a monitor type.
func (r *GORMMonitorTypeRepository) CountReferences(ctx context.Context, code string) (MonitorTypeReferenceCounts, error) {
	counts := MonitorTypeReferenceCounts{}
	if err := r.db.WithContext(ctx).Model(&mappingRecord{}).
		Where("monitor_type = ?", code).Count(&counts.Mappings).Error; err != nil {
		return counts, fmt.Errorf("count monitor type mappings: %w", err)
	}
	if err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("monitor_type = ?", code).Count(&counts.Jobs).Error; err != nil {
		return counts, fmt.Errorf("count monitor type jobs: %w", err)
	}
	if err := r.db.WithContext(ctx).Model(&ruleRecord{}).
		Where("monitor_type = ?", code).Count(&counts.Rules).Error; err != nil {
		return counts, fmt.Errorf("count monitor type rules: %w", err)
	}
	// Metric anchors are stored as a JSON array of {monitor_type,…} objects; a
	// quoted LIKE is portable across SQLite and PostgreSQL and needs no dialect
	// switch. False positives are impossible because the value is quoted.
	pattern := "%\"" + strings.TrimSpace(code) + "\"%"
	if err := r.db.WithContext(ctx).Model(&metricRecord{}).
		Where("monitor_types LIKE ?", pattern).Count(&counts.MetricAnchors).Error; err != nil {
		return counts, fmt.Errorf("count monitor type metric anchors: %w", err)
	}
	return counts, nil
}

// rulesByCode groups live rules by monitor type, optionally restricted to a
// set of codes.
func (r *GORMMonitorTypeRepository) rulesByCode(ctx context.Context, codes []string) (map[string][]domain.MonitorTypeRule, error) {
	query := r.db.WithContext(ctx).Model(&monitorTypeRuleRecord{})
	if len(codes) > 0 {
		query = query.Where("monitor_type_code IN ?", codes)
	}
	var recs []monitorTypeRuleRecord
	if err := query.Order("monitor_type_code ASC, priority ASC, id ASC").Find(&recs).Error; err != nil {
		return nil, fmt.Errorf("list monitor type rules: %w", err)
	}
	out := make(map[string][]domain.MonitorTypeRule, len(recs))
	for _, rec := range recs {
		out[rec.MonitorTypeCode] = append(out[rec.MonitorTypeCode], rec.toDomain())
	}
	return out, nil
}
