package service

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// MonitorTypeCandidateCounter counts M07 resources matched by a monitor type
// scope. It is optional: without it the change-impact preview only reports
// stored references (FR-24).
type MonitorTypeCandidateCounter interface {
	CountCandidates(ctx context.Context, monitorType string) (int64, error)
}

// MonitorTypeService implements the configurable monitor type registry
// (SRS Module_01 v1.3 §5.6, FR-21 ~ FR-24).
//
// It owns the process-wide registry snapshot: every write reloads the snapshot
// and installs it, so job validation and candidate queries observe the change
// immediately without a restart (NFR-11).
type MonitorTypeService struct {
	repo     repository.MonitorTypeRepository
	counter  MonitorTypeCandidateCounter
	mu       sync.RWMutex
	registry *domain.MonitorTypeRegistry
}

// NewMonitorTypeService constructs the service and seeds the in-memory snapshot
// with the built-in types so read paths work before the first refresh.
func NewMonitorTypeService(repo repository.MonitorTypeRepository) *MonitorTypeService {
	return &MonitorTypeService{
		repo:     repo,
		registry: domain.NewMonitorTypeRegistry(domain.BuiltinMonitorTypeEntries()),
	}
}

// SetCandidateCounter wires the optional M07 candidate counter used by the
// change-impact preview.
func (s *MonitorTypeService) SetCandidateCounter(counter MonitorTypeCandidateCounter) {
	s.counter = counter
}

// Registry returns the current snapshot.
func (s *MonitorTypeService) Registry() *domain.MonitorTypeRegistry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.registry
}

// EnsureBuiltins inserts any missing built-in type (FR-21, NFR-11 idempotent
// seed). It is safe on every boot and never overwrites a user edit: existing
// rows, including disabled ones, are left untouched.
func (s *MonitorTypeService) EnsureBuiltins(ctx context.Context) error {
	for _, entry := range domain.BuiltinMonitorTypeEntries() {
		if _, found, err := s.repo.Get(ctx, entry.Definition.Code); err != nil {
			return err
		} else if found {
			continue
		}
		if err := s.repo.Create(ctx, entry); err != nil {
			return fmt.Errorf("create built-in monitor type %q: %w", entry.Definition.Code, err)
		}
	}
	return nil
}

// Refresh reloads every definition and rule and installs a new snapshot.
//
// An empty table means the seed has not run yet (fresh schema, unit tests): the
// built-in snapshot stays active so reads never fail closed.
func (s *MonitorTypeService) Refresh(ctx context.Context) error {
	entries, err := s.repo.List(ctx)
	if err != nil {
		return err
	}
	registry := domain.NewMonitorTypeRegistry(entries)
	if len(entries) == 0 {
		registry = domain.NewMonitorTypeRegistry(domain.BuiltinMonitorTypeEntries())
	}
	s.install(registry)
	return nil
}

func (s *MonitorTypeService) install(registry *domain.MonitorTypeRegistry) {
	s.mu.Lock()
	s.registry = registry
	s.mu.Unlock()
	domain.InstallMonitorTypeRegistry(registry)
}

// List returns every live definition with its rules.
func (s *MonitorTypeService) List(ctx context.Context) ([]domain.MonitorTypeEntry, error) {
	return s.repo.List(ctx)
}

// ListByCategory returns the definitions of one resource category.
func (s *MonitorTypeService) ListByCategory(ctx context.Context, category domain.ResourceCategory) ([]domain.MonitorTypeEntry, error) {
	entries, err := s.repo.List(ctx)
	if err != nil {
		return nil, err
	}
	if category == "" {
		return entries, nil
	}
	out := make([]domain.MonitorTypeEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.Definition.ResourceCategory == category {
			out = append(out, entry)
		}
	}
	return out, nil
}

// Get loads one definition.
func (s *MonitorTypeService) Get(ctx context.Context, code string) (domain.MonitorTypeEntry, error) {
	code = strings.TrimSpace(code)
	entry, found, err := s.repo.Get(ctx, code)
	if err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	if !found {
		return domain.MonitorTypeEntry{}, &domain.NotFoundError{Entity: "monitor_type", ID: code}
	}
	return entry, nil
}

// Create registers a new monitor type (FR-21). User-created types are never
// marked built-in, so they stay deletable.
func (s *MonitorTypeService) Create(ctx context.Context, entry domain.MonitorTypeEntry) (domain.MonitorTypeEntry, error) {
	entry.Definition.Code = strings.TrimSpace(entry.Definition.Code)
	entry.Definition.Name = strings.TrimSpace(entry.Definition.Name)
	entry.Definition.IsBuiltin = false
	// A freshly created type is usable right away; disabling it is an explicit
	// follow-up edit (FR-21 / FR-24).
	entry.Definition.Enabled = true
	if entry.Definition.RuleLogic == "" {
		entry.Definition.RuleLogic = domain.RuleLogicAll
	}
	if entry.Definition.SortOrder == 0 {
		entry.Definition.SortOrder = 500
	}
	if err := domain.ValidateMonitorTypeEntry(entry.Definition, entry.Rules); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	normalizeRules(&entry)
	if err := s.repo.Create(ctx, entry); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	if err := s.Refresh(ctx); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	return s.Get(ctx, entry.Definition.Code)
}

// Update replaces the mutable definition fields and the whole rule set
// (FR-21 / FR-22).
func (s *MonitorTypeService) Update(ctx context.Context, code string, entry domain.MonitorTypeEntry) (domain.MonitorTypeEntry, error) {
	code = strings.TrimSpace(code)
	existing, err := s.Get(ctx, code)
	if err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	entry.Definition.Code = code
	entry.Definition.IsBuiltin = existing.Definition.IsBuiltin
	entry.Definition.Name = strings.TrimSpace(entry.Definition.Name)
	if entry.Definition.RuleLogic == "" {
		entry.Definition.RuleLogic = existing.Definition.RuleLogic
	}
	if entry.Definition.ResourceCategory == "" {
		entry.Definition.ResourceCategory = existing.Definition.ResourceCategory
	}
	if err := domain.ValidateMonitorTypeEntry(entry.Definition, entry.Rules); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	normalizeRules(&entry)
	if err := s.repo.Update(ctx, entry.Definition); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	if err := s.repo.ReplaceRules(ctx, code, entry.Rules); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	if err := s.Refresh(ctx); err != nil {
		return domain.MonitorTypeEntry{}, err
	}
	return s.Get(ctx, code)
}

// Delete removes a user-created type. Built-in types may only be disabled, and
// any live reference blocks the delete (FR-24).
func (s *MonitorTypeService) Delete(ctx context.Context, code string) error {
	code = strings.TrimSpace(code)
	existing, err := s.Get(ctx, code)
	if err != nil {
		return err
	}
	if existing.Definition.IsBuiltin {
		return &domain.ForbiddenError{
			Message: fmt.Sprintf("monitor type %q is built in and can only be disabled", code),
		}
	}
	counts, err := s.repo.CountReferences(ctx, code)
	if err != nil {
		return err
	}
	if counts.Total() > 0 {
		return &domain.ConflictError{
			Entity: "monitor_type",
			Field:  "code",
			Value:  code,
			Message: fmt.Sprintf(
				"monitor type %q is still referenced (mappings=%d, jobs=%d, rules=%d, metric_anchors=%d)",
				code, counts.Mappings, counts.Jobs, counts.Rules, counts.MetricAnchors),
		}
	}
	if err := s.repo.SoftDelete(ctx, code); err != nil {
		return err
	}
	return s.Refresh(ctx)
}

// Impact reports the stored references plus, when a candidate counter is wired,
// how many M07 resources the current rules match (FR-24).
func (s *MonitorTypeService) Impact(ctx context.Context, code string) (MonitorTypeImpact, error) {
	code = strings.TrimSpace(code)
	entry, err := s.Get(ctx, code)
	if err != nil {
		return MonitorTypeImpact{}, err
	}
	counts, err := s.repo.CountReferences(ctx, code)
	if err != nil {
		return MonitorTypeImpact{}, err
	}
	out := MonitorTypeImpact{Code: code, References: counts}
	if s.counter != nil {
		matched, err := s.counter.CountCandidates(ctx, code)
		if err != nil {
			return MonitorTypeImpact{}, err
		}
		out.MatchedResources = matched
	}
	out.RuleCount = int64(len(entry.Rules))
	return out, nil
}

// MonitorTypeImpact is the change-impact preview payload (FR-24).
type MonitorTypeImpact struct {
	Code             string                            `json:"code"`
	References       repository.MonitorTypeReferenceCounts `json:"references"`
	RuleCount        int64                             `json:"rule_count"`
	MatchedResources int64                             `json:"matched_resources"`
}

// ScopeFields returns the closed whitelist of rule fields for the UI picker.
func (s *MonitorTypeService) ScopeFields() []domain.ScopeFieldSpec {
	return domain.ScopeFieldSpecs()
}

func normalizeRules(entry *domain.MonitorTypeEntry) {
	for i := range entry.Rules {
		rule := &entry.Rules[i]
		rule.MonitorTypeCode = entry.Definition.Code
		rule.Field = strings.TrimSpace(rule.Field)
		if rule.Priority == 0 {
			rule.Priority = (i + 1) * 10
		}
		if rule.ID == "" {
			if id, err := domain.NewID(); err == nil {
				rule.ID = id
			}
		}
		values := make([]string, 0, len(rule.Values))
		for _, value := range rule.Values {
			trimmed := strings.TrimSpace(value)
			if trimmed == "" {
				continue
			}
			values = append(values, trimmed)
		}
		rule.Values = values
		if rule.Operator == domain.RuleOpAlways {
			rule.Values = nil
		}
	}
}
