package service

import (
	"context"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// BusinessMetricService implements the business metric catalogue (FR-19).
type BusinessMetricService struct {
	repo repository.BusinessMetricRepository
}

// NewBusinessMetricService constructs the service.
func NewBusinessMetricService(repo repository.BusinessMetricRepository) *BusinessMetricService {
	return &BusinessMetricService{repo: repo}
}

// List returns a page of business metrics.
func (s *BusinessMetricService) List(ctx context.Context, filter repository.BusinessMetricFilter) ([]*domain.BusinessMetric, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one business metric.
func (s *BusinessMetricService) Get(ctx context.Context, id string) (*domain.BusinessMetric, error) {
	return s.repo.Get(ctx, id)
}

// Create inserts a business metric.
func (s *BusinessMetricService) Create(ctx context.Context, metric *domain.BusinessMetric) (*domain.BusinessMetric, error) {
	if metric == nil {
		return nil, domain.NewValidationError("business_metric", "is required")
	}
	normalizeBusinessMetric(metric)
	metric.Status = domain.BusinessMetricPending
	if err := validateBusinessMetric(metric); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, metric); err != nil {
		return nil, err
	}
	return metric, nil
}

// Update replaces a business metric, enforcing the status machine.
func (s *BusinessMetricService) Update(ctx context.Context, id string, input *domain.BusinessMetric) (*domain.BusinessMetric, error) {
	if input == nil {
		return nil, domain.NewValidationError("business_metric", "is required")
	}
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	input.ID = existing.ID
	input.CreatedAt = existing.CreatedAt
	normalizeBusinessMetric(input)
	if input.Status == "" {
		input.Status = existing.Status
	}
	if err := validateBusinessStatus(existing.Status, input.Status); err != nil {
		return nil, err
	}
	if err := validateBusinessMetric(input); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, input); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id)
}

// Delete removes a business metric that is still pending.
func (s *BusinessMetricService) Delete(ctx context.Context, id string) error {
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.Status != domain.BusinessMetricPending {
		return &domain.ForbiddenError{Message: "only pending business metrics can be deleted"}
	}
	return s.repo.SoftDelete(ctx, id)
}

func normalizeBusinessMetric(metric *domain.BusinessMetric) {
	metric.MetricName = strings.TrimSpace(metric.MetricName)
	metric.Owner = strings.TrimSpace(metric.Owner)
	if metric.MetricType == "" {
		metric.MetricType = domain.MetricGauge
	}
	if metric.RegisterSource == "" {
		metric.RegisterSource = domain.RegisterSourceSelf
	}
}

func validateBusinessMetric(metric *domain.BusinessMetric) error {
	if metric.MetricName == "" {
		return domain.NewValidationError("metric_name", "is required")
	}
	if len(metric.MetricName) > 200 {
		return domain.NewValidationError("metric_name", "must be at most 200 characters")
	}
	if metric.Owner == "" {
		return domain.NewValidationError("owner", "is required")
	}
	if !metric.MetricType.Valid() {
		return domain.NewValidationError("metric_type", "must be counter, gauge, histogram, summary or unknown")
	}
	if !metric.RegisterSource.Valid() {
		return domain.NewValidationError("register_source", "must be self or agent")
	}
	return nil
}

func validateBusinessStatus(from, to domain.BusinessMetricStatus) error {
	if from == to {
		return nil
	}
	allowed := false
	switch from {
	case domain.BusinessMetricPending:
		allowed = to == domain.BusinessMetricInstrumented
	case domain.BusinessMetricInstrumented:
		allowed = to == domain.BusinessMetricOnline
	}
	if !allowed {
		return domain.NewValidationErrorf("status", "invalid transition %s → %s", from, to)
	}
	return nil
}
