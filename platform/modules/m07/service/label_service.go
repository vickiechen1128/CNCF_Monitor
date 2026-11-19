package service

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/references"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
)

// LabelService implements resource label use cases.
type LabelService struct {
	labels    repository.LabelRepository
	resources repository.ResourceRepository
	notifier  references.ResourceChangeNotifier
}

// NewLabelService constructs a label service.
func NewLabelService(labels repository.LabelRepository, resources repository.ResourceRepository) *LabelService {
	return &LabelService{labels: labels, resources: resources, notifier: references.NoopChangeNotifier{}}
}

// SetChangeNotifier wires the best-effort M01/M09 change notification port.
func (s *LabelService) SetChangeNotifier(notifier references.ResourceChangeNotifier) {
	if notifier != nil {
		s.notifier = notifier
	}
}

// List returns labels for a resource.
func (s *LabelService) List(ctx context.Context, resourceID string) ([]domain.Label, error) {
	return s.labels.List(ctx, resourceID)
}

// Add adds a user label after checking the category write boundary.
func (s *LabelService) Add(ctx context.Context, resourceID, key, value string) (*domain.Label, error) {
	resource, err := s.writableResource(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	label := &domain.Label{
		ResourceID: resource.ResourceID,
		Key:        key,
		Value:      value,
		Source:     domain.LabelSourceUser,
	}
	if err := s.labels.Create(ctx, label); err != nil {
		return nil, err
	}
	s.notify(ctx, resource.NetworkDomainID)
	return label, nil
}

// Update updates a user label value.
func (s *LabelService) Update(ctx context.Context, resourceID, labelID, value string) (*domain.Label, error) {
	resource, err := s.writableResource(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	label, err := s.labels.Update(ctx, resourceID, labelID, value)
	if err != nil {
		return nil, err
	}
	s.notify(ctx, resource.NetworkDomainID)
	return label, nil
}

// Delete deletes a user label.
func (s *LabelService) Delete(ctx context.Context, resourceID, labelID string) error {
	resource, err := s.writableResource(ctx, resourceID)
	if err != nil {
		return err
	}
	if err := s.labels.Delete(ctx, resourceID, labelID); err != nil {
		return err
	}
	s.notify(ctx, resource.NetworkDomainID)
	return nil
}

func (s *LabelService) notify(ctx context.Context, domainID string) {
	if s.notifier != nil {
		s.notifier.ResourceChanged(ctx, domainID)
	}
}

func (s *LabelService) writableResource(ctx context.Context, resourceID string) (*domain.Resource, error) {
	resource, err := s.resources.Get(ctx, resourceID)
	if err != nil {
		return nil, err
	}
	if !domain.IsWritableCategory(resource.Category) {
		return nil, &domain.ForbiddenError{
			Message: fmt.Sprintf("user labels are not writable for category %s", resource.Category),
		}
	}
	return resource, nil
}
