package service

import (
	"context"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
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

func normalizeMetric(metric *domain.Metric) {
	metric.MetricName = strings.TrimSpace(metric.MetricName)
	metric.Category = strings.TrimSpace(metric.Category)
	if metric.MetricType == "" {
		metric.MetricType = domain.MetricUnknown
	}
}

func validateMetric(metric *domain.Metric) error {
	if metric.MetricName == "" {
		return domain.NewValidationError("metric_name", "is required")
	}
	if len(metric.MetricName) > 200 {
		return domain.NewValidationError("metric_name", "must be at most 200 characters")
	}
	if !metric.MetricType.Valid() {
		return domain.NewValidationError("metric_type", "must be counter, gauge, histogram, summary or unknown")
	}
	for _, anchor := range metric.MonitorTypes {
		if !domain.ValidMonitorType(anchor.MonitorType) {
			return domain.NewValidationErrorf("monitor_types", "unknown monitor type %q", anchor.MonitorType)
		}
	}
	return nil
}
