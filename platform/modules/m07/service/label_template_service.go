package service

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// LabelTemplateService implements label template use cases for v3.
type LabelTemplateService struct {
	repo     repository.LabelTemplateRepository
	usage    references.LabelTemplateUsageChecker
	notifier references.ResourceChangeNotifier
}

// NewLabelTemplateService constructs the service. A nil usage checker means
// "not referenced anywhere" (tests / standalone wiring).
func NewLabelTemplateService(repo repository.LabelTemplateRepository, usage references.LabelTemplateUsageChecker) *LabelTemplateService {
	if usage == nil {
		usage = references.NoopLabelTemplateUsageChecker{}
	}
	return &LabelTemplateService{repo: repo, usage: usage, notifier: references.NoopChangeNotifier{}}
}

// SetChangeNotifier wires the best-effort M01/M09 change notification port.
func (s *LabelTemplateService) SetChangeNotifier(notifier references.ResourceChangeNotifier) {
	if notifier != nil {
		s.notifier = notifier
	}
}

func (s *LabelTemplateService) notifyAll(ctx context.Context) {
	if s.notifier != nil {
		s.notifier.AllResourcesChanged(ctx)
	}
}

// List returns a page of label templates.
func (s *LabelTemplateService) List(ctx context.Context, filter repository.LabelTemplateFilter) ([]*domain.LabelTemplate, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one label template.
func (s *LabelTemplateService) Get(ctx context.Context, id string) (*domain.LabelTemplate, error) {
	return s.repo.Get(ctx, id)
}

// Create inserts a label template.
func (s *LabelTemplateService) Create(ctx context.Context, template *domain.LabelTemplate) (*domain.LabelTemplate, error) {
	if template == nil {
		return nil, &domain.ValidationError{Field: "label_template", Message: "is required"}
	}
	template.Normalize()
	if err := template.Validate(); err != nil {
		return nil, err
	}
	if template.IsDefault {
		if err := s.repo.ClearDefault(ctx, template.ResourceCategory, ""); err != nil {
			return nil, err
		}
	}
	if err := s.repo.Create(ctx, template); err != nil {
		return nil, err
	}
	s.notifyAll(ctx)
	return s.repo.Get(ctx, template.ID)
}

// Update replaces a label template. resource_category is immutable.
func (s *LabelTemplateService) Update(ctx context.Context, id string, input *domain.LabelTemplate) (*domain.LabelTemplate, error) {
	if input == nil {
		return nil, &domain.ValidationError{Field: "label_template", Message: "is required"}
	}
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if input.ResourceCategory != "" && input.ResourceCategory != existing.ResourceCategory {
		return nil, &domain.ValidationError{
			Field:   "resource_category",
			Message: fmt.Sprintf("is immutable (current %q)", existing.ResourceCategory),
		}
	}
	input.ID = existing.ID
	input.ResourceCategory = existing.ResourceCategory
	input.CreatedAt = existing.CreatedAt
	input.Normalize()
	if err := input.Validate(); err != nil {
		return nil, err
	}
	if input.IsDefault && !existing.IsDefault {
		if err := s.repo.ClearDefault(ctx, input.ResourceCategory, existing.ID); err != nil {
			return nil, err
		}
	}
	if err := s.repo.Update(ctx, input); err != nil {
		return nil, err
	}
	s.notifyAll(ctx)
	return s.repo.Get(ctx, id)
}

// Delete soft-deletes an unreferenced template.
func (s *LabelTemplateService) Delete(ctx context.Context, id string) error {
	if _, err := s.repo.Get(ctx, id); err != nil {
		return err
	}
	count, err := s.usage.CountReferences(ctx, id)
	if err != nil {
		return fmt.Errorf("count label template references: %w", err)
	}
	if count > 0 {
		return &domain.LabelTemplateConflictError{
			Message: fmt.Sprintf("label template %q is referenced by %d M01 record(s)", id, count),
		}
	}
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return err
	}
	s.notifyAll(ctx)
	return nil
}
