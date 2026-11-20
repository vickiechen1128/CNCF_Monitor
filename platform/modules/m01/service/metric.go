package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// Prometheus naming rules (contract §7.1) and light guardrails for user entries.
var (
	metricNamePattern = regexp.MustCompile(`^[a-zA-Z_:][a-zA-Z0-9_:]*$`)
	labelNamePattern  = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)
)

const (
	maxMetricNameLength = 200
	maxMetricLabels     = 64
)

// MetricService implements the technical metric catalogue (FR-18).
type MetricService struct {
	repo repository.MetricRepository
}

// NewMetricService constructs the service.
func NewMetricService(repo repository.MetricRepository) *MetricService {
	return &MetricService{repo: repo}
}

// List returns a page of metrics.
func (s *MetricService) List(ctx context.Context, filter repository.MetricFilter) ([]*domain.Metric, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one metric.
func (s *MetricService) Get(ctx context.Context, id string) (*domain.Metric, error) {
	return s.repo.Get(ctx, id)
}

// Create inserts a user-defined metric.
func (s *MetricService) Create(ctx context.Context, metric *domain.Metric) (*domain.Metric, error) {
	if metric == nil {
		return nil, domain.NewValidationError("metric", "is required")
	}
	normalizeMetric(metric)
	metric.IsBuiltin = false
	if err := validateMetric(metric); err != nil {
		return nil, err
	}
	if err := s.ensureNoAnchorConflict(ctx, metric, ""); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, metric); err != nil {
		return nil, err
	}
	return metric, nil
}

// Update replaces a user-defined metric. Built-in rows are read-only.
func (s *MetricService) Update(ctx context.Context, id string, input *domain.Metric) (*domain.Metric, error) {
	if input == nil {
		return nil, domain.NewValidationError("metric", "is required")
	}
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.IsBuiltin {
		return nil, &domain.ForbiddenError{Message: "built-in metrics are read-only"}
	}
	input.ID = existing.ID
	input.IsBuiltin = false
	input.CreatedAt = existing.CreatedAt
	normalizeMetric(input)
	if err := validateMetric(input); err != nil {
		return nil, err
	}
	if err := s.ensureNoAnchorConflict(ctx, input, existing.ID); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, input); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id)
}

// Delete soft-deletes a user-defined metric.
func (s *MetricService) Delete(ctx context.Context, id string) error {
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.IsBuiltin {
		return &domain.ForbiddenError{Message: "built-in metrics are read-only"}
	}
	return s.repo.SoftDelete(ctx, id)
}

// ensureNoAnchorConflict enforces the contract's (metric_name, template_code)
// uniqueness for user entries: the same name may be registered under different
// collection templates, but not twice for the same anchor.
func (s *MetricService) ensureNoAnchorConflict(ctx context.Context, metric *domain.Metric, excludeID string) error {
	if len(metric.CollectionTemplates) == 0 {
		return nil
	}
	monitorTypes := make([]string, 0, len(metric.CollectionTemplates))
	for _, anchor := range metric.CollectionTemplates {
		monitorTypes = append(monitorTypes, anchor.TemplateCode)
	}
	conflict, err := s.repo.HasAnchorConflict(ctx, metric.MetricName, monitorTypes, excludeID)
	if err != nil {
		return err
	}
	if conflict {
		return &domain.ConflictError{
			Entity:  "metric",
			Field:   "metric_name",
			Value:   metric.MetricName,
			Message: fmt.Sprintf("metric %q already exists under one of the selected collection templates", metric.MetricName),
		}
	}
	return nil
}

func normalizeMetric(metric *domain.Metric) {
	metric.MetricName = strings.TrimSpace(metric.MetricName)
	metric.Category = strings.TrimSpace(metric.Category)
	metric.Unit = strings.TrimSpace(metric.Unit)
	if metric.MetricType == "" {
		metric.MetricType = domain.MetricUnknown
	}
	metric.Labels = normalizeMetricLabels(metric.Labels)
	metric.CollectionTemplates = normalizeMetricAnchors(metric.CollectionTemplates)
}

func normalizeMetricLabels(labels []string) []string {
	if len(labels) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(labels))
	seen := make(map[string]struct{}, len(labels))
	for _, label := range labels {
		name := strings.TrimSpace(label)
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		out = append(out, name)
	}
	return out
}

func normalizeMetricAnchors(anchors []domain.MetricAnchor) []domain.MetricAnchor {
	if len(anchors) == 0 {
		return []domain.MetricAnchor{}
	}
	out := make([]domain.MetricAnchor, 0, len(anchors))
	seen := make(map[string]struct{}, len(anchors))
	for _, anchor := range anchors {
		code := strings.TrimSpace(anchor.TemplateCode)
		if code == "" {
			continue
		}
		if _, ok := seen[code]; ok {
			continue
		}
		seen[code] = struct{}{}
		out = append(out, domain.MetricAnchor{
			TemplateCode:   code,
			SourceExporter: strings.TrimSpace(anchor.SourceExporter),
		})
	}
	return out
}

func validateMetric(metric *domain.Metric) error {
	if metric.MetricName == "" {
		return domain.NewValidationError("metric_name", "is required")
	}
	if len(metric.MetricName) > maxMetricNameLength {
		return domain.NewValidationErrorf("metric_name", "must be at most %d characters", maxMetricNameLength)
	}
	if !metricNamePattern.MatchString(metric.MetricName) {
		return domain.NewValidationError("metric_name", "must follow Prometheus naming rules (letters, digits, underscores and colons; must not start with a digit)")
	}
	if !metric.MetricType.Valid() {
		return domain.NewValidationError("metric_type", "must be counter, gauge, histogram, summary or unknown")
	}
	if len(metric.Labels) > maxMetricLabels {
		return domain.NewValidationErrorf("labels", "must have at most %d entries", maxMetricLabels)
	}
	for _, label := range metric.Labels {
		if !labelNamePattern.MatchString(label) {
			return domain.NewValidationErrorf("labels", "invalid label name %q", label)
		}
	}
	for _, anchor := range metric.CollectionTemplates {
		if strings.TrimSpace(anchor.TemplateCode) == "" {
			return domain.NewValidationError("collection_templates", "template_code is required")
		}
	}
	return nil
}
