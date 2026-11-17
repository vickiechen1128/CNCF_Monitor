package service

import (
	"context"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// InhibitionService manages inhibit rules (FR-18..20, D49). Every successful
// mutation regenerates alertmanager.yml and reloads, preserving the current
// routing tree.
type InhibitionService struct {
	rules  repository.InhibitionRepository
	config *ConfigService
}

// NewInhibitionService constructs the service.
func NewInhibitionService(rules repository.InhibitionRepository, config *ConfigService) *InhibitionService {
	return &InhibitionService{rules: rules, config: config}
}

// List returns a searchable page of rules.
func (s *InhibitionService) List(ctx context.Context, filter repository.InhibitionFilter) ([]*domain.InhibitionRule, int64, error) {
	return s.rules.List(ctx, filter)
}

// Create stores a new rule and regenerates the configuration.
func (s *InhibitionService) Create(ctx context.Context, rule *domain.InhibitionRule, baseChecksum, operator string) (*domain.InhibitionRule, *SaveOutcome, error) {
	if issues := domain.ValidateInhibition(rule); len(issues) > 0 {
		return nil, nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	rule.Builtin = false
	if err := s.rules.Create(ctx, rule); err != nil {
		return nil, nil, err
	}
	outcome, err := s.config.SaveAfterInhibitionChange(ctx, baseChecksum, operator)
	if err != nil {
		return nil, nil, err
	}
	return rule, outcome, nil
}

// Update edits a rule and regenerates the configuration.
func (s *InhibitionService) Update(ctx context.Context, id string, patch *domain.InhibitionRule, baseChecksum, operator string) (*domain.InhibitionRule, *SaveOutcome, error) {
	existing, err := s.rules.Get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	patch.ID = id
	patch.Builtin = existing.Builtin
	if issues := domain.ValidateInhibition(patch); len(issues) > 0 {
		return nil, nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	if err := s.rules.Update(ctx, patch); err != nil {
		return nil, nil, err
	}
	outcome, err := s.config.SaveAfterInhibitionChange(ctx, baseChecksum, operator)
	if err != nil {
		return nil, nil, err
	}
	return patch, outcome, nil
}

// SetEnabled toggles a rule (built-ins may be enabled/disabled but not deleted).
func (s *InhibitionService) SetEnabled(ctx context.Context, id string, enabled bool, baseChecksum, operator string) (*domain.InhibitionRule, *SaveOutcome, error) {
	rule, err := s.rules.Get(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	rule.Enabled = enabled
	if err := s.rules.Update(ctx, rule); err != nil {
		return nil, nil, err
	}
	outcome, err := s.config.SaveAfterInhibitionChange(ctx, baseChecksum, operator)
	if err != nil {
		return nil, nil, err
	}
	return rule, outcome, nil
}

// Delete removes a custom rule; built-ins are protected (FR-19).
func (s *InhibitionService) Delete(ctx context.Context, id, baseChecksum, operator string) (*SaveOutcome, error) {
	rule, err := s.rules.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if rule.Builtin {
		return nil, &domain.ConflictError{Message: "系统预置抑制规则不可删除，可停用或调整参数"}
	}
	if err := s.rules.SoftDelete(ctx, id); err != nil {
		return nil, err
	}
	return s.config.SaveAfterInhibitionChange(ctx, baseChecksum, operator)
}
