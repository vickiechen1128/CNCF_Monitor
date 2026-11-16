package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// RuleValidation is the pre-submit validation result (contract §6.3).
type RuleValidation struct {
	Valid        bool
	Error        string
	Groups       int
	Rules        int
	JobRef       []domain.JobRefIssue
	PromQLStatus string
	PromQLError  string
}

// RuleService implements monitoring rule use cases (FR-14 ~ FR-16).
type RuleService struct {
	rules     repository.RuleRepository
	jobs      repository.JobRepository
	exporters repository.ExporterTemplateRepository
	checker   PromQLChecker
}

// NewRuleService constructs the service.
func NewRuleService(
	rules repository.RuleRepository,
	jobs repository.JobRepository,
	exporters repository.ExporterTemplateRepository,
	checker PromQLChecker,
) *RuleService {
	if checker == nil {
		checker = NewPromtoolChecker()
	}
	return &RuleService{rules: rules, jobs: jobs, exporters: exporters, checker: checker}
}

// List returns a page of rules.
func (s *RuleService) List(ctx context.Context, filter repository.RuleFilter) ([]*domain.Rule, int64, error) {
	return s.rules.List(ctx, filter)
}

// Get returns one rule.
func (s *RuleService) Get(ctx context.Context, id string) (*domain.Rule, error) {
	return s.rules.Get(ctx, id)
}

// Create validates and inserts a rule.
func (s *RuleService) Create(ctx context.Context, input *domain.Rule, ack bool, ackReason string) (*domain.Rule, error) {
	if input == nil {
		return nil, domain.NewValidationError("monitoring_rule", "is required")
	}
	if err := s.prepare(ctx, input, nil, ack); err != nil {
		return nil, err
	}
	input.AckJobRefErrors = ack
	input.AckReason = strings.TrimSpace(ackReason)
	if input.Enabled && input.DraftStatus == domain.DraftStatusReady {
		input.Sync = domain.SyncState{Status: domain.SyncPending}
	} else {
		input.Sync = domain.SyncState{Status: domain.SyncDraft}
	}
	if err := s.rules.Create(ctx, input); err != nil {
		return nil, err
	}
	return input, nil
}

// Update validates and replaces an existing rule.
func (s *RuleService) Update(ctx context.Context, id string, input *domain.Rule, ack bool, ackReason string) (*domain.Rule, error) {
	if input == nil {
		return nil, domain.NewValidationError("monitoring_rule", "is required")
	}
	existing, err := s.rules.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	input.ID = existing.ID
	input.CreatedAt = existing.CreatedAt
	if err := s.prepare(ctx, input, existing, ack); err != nil {
		return nil, err
	}
	input.AckJobRefErrors = ack
	input.AckReason = strings.TrimSpace(ackReason)
	if input.Enabled && input.DraftStatus == domain.DraftStatusReady {
		input.Sync = domain.SyncState{Status: domain.SyncPending}
	} else {
		input.Sync = domain.SyncState{Status: domain.SyncDraft}
	}
	if err := s.rules.Update(ctx, input); err != nil {
		return nil, err
	}
	return input, nil
}

// Delete soft-deletes a rule.
func (s *RuleService) Delete(ctx context.Context, id string) error {
	return s.rules.SoftDelete(ctx, id)
}

// Validate runs the pre-submit checks without persisting anything.
func (s *RuleService) Validate(ctx context.Context, id, content string) (*RuleValidation, error) {
	return s.evaluate(ctx, content, id)
}

func (s *RuleService) prepare(ctx context.Context, rule *domain.Rule, existing *domain.Rule, ack bool) error {
	normalizeRule(rule)
	if rule.ContentMode == domain.RuleStructured {
		return domain.NewValidationError("content_mode", "structured editing is not supported in this version")
	}
	rule.ContentMode = domain.RuleYAMLPassthrough
	if rule.Scope == "" {
		rule.Scope = domain.ScopeCentral
	}
	if rule.Scope != domain.ScopeCentral {
		return domain.NewValidationError("scope", "only central evaluation is supported")
	}
	if rule.MonitorType != "" && !domain.ValidMonitorType(rule.MonitorType) {
		return domain.NewValidationErrorf("monitor_type", "unknown monitor type %q", rule.MonitorType)
	}
	if rule.ExporterTemplateID != "" {
		if _, err := s.exporters.Get(ctx, rule.ExporterTemplateID); err != nil {
			return err
		}
	}
	excludeID := ""
	if existing != nil {
		excludeID = existing.ID
	}
	result, err := s.evaluate(ctx, rule.RuleContent, excludeID)
	if err != nil {
		return err
	}
	if !result.Valid {
		return domain.NewValidationError("rule_content", result.Error)
	}
	if !ack {
		for _, issue := range result.JobRef {
			if issue.Severity == "error" {
				return domain.NewValidationErrorf("job_ref", "%s（如确认先挂规则后建 Job，请勾选逃生门）", issue.Message)
			}
		}
	}
	file, err := domain.ParseRules(rule.RuleContent)
	if err != nil {
		return err
	}
	if rule.Name == "" && len(file.Groups) > 0 {
		rule.Name = file.Groups[0].Name
	}
	return nil
}

func (s *RuleService) evaluate(ctx context.Context, content, excludeID string) (*RuleValidation, error) {
	result := &RuleValidation{Valid: false}
	file, err := domain.ParseRules(content)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	result.Groups = len(file.Groups)
	result.Rules = file.RuleCount()

	others, err := s.rules.ListEnabledReady(ctx)
	if err != nil {
		return nil, err
	}
	existingGroups := make(map[string]string)
	for _, other := range others {
		if other.ID == excludeID {
			continue
		}
		otherFile, err := domain.ParseRules(other.RuleContent)
		if err != nil {
			continue
		}
		for _, group := range otherFile.GroupNames() {
			existingGroups[group] = other.Name
		}
	}
	for _, group := range file.GroupNames() {
		if owner, conflict := existingGroups[group]; conflict {
			result.Error = fmt.Sprintf("group %q conflicts with rule %q", group, owner)
			return result, nil
		}
	}

	jobNames, err := s.jobs.ListActiveNames(ctx)
	if err != nil {
		return nil, err
	}
	result.JobRef = file.JobRefIssues(jobNames)

	result.PromQLStatus, result.PromQLError = s.checker.Check(ctx, content)
	if result.PromQLStatus == "failed" {
		result.Error = "PromQL validation failed: " + result.PromQLError
		return result, nil
	}
	result.Valid = true
	return result, nil
}

func normalizeRule(rule *domain.Rule) {
	rule.Name = strings.TrimSpace(rule.Name)
	rule.RuleContent = strings.TrimSpace(rule.RuleContent)
	rule.MonitorType = strings.TrimSpace(rule.MonitorType)
	rule.ExporterTemplateID = strings.TrimSpace(rule.ExporterTemplateID)
	if rule.DraftStatus == "" {
		rule.DraftStatus = domain.DraftStatusReady
	}
}
