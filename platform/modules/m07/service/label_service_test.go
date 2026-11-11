package service

import (
	"context"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeLabelRepository struct {
	labels map[string]*domain.Label
}

func newFakeLabelRepository() *fakeLabelRepository {
	return &fakeLabelRepository{labels: map[string]*domain.Label{}}
}

func (f *fakeLabelRepository) List(_ context.Context, resourceID string) ([]domain.Label, error) {
	out := make([]domain.Label, 0)
	for _, label := range f.labels {
		if label.ResourceID == resourceID {
			out = append(out, *label)
		}
	}
	return out, nil
}

func (f *fakeLabelRepository) Create(_ context.Context, label *domain.Label) error {
	if err := label.Validate(); err != nil {
		return err
	}
	if label.ID == "" {
		id, err := domain.NewResourceID()
		if err != nil {
			return err
		}
		label.ID = id
	}
	f.labels[label.ID] = label
	return nil
}

func (f *fakeLabelRepository) Update(_ context.Context, resourceID, labelID, value string) (*domain.Label, error) {
	label, ok := f.labels[labelID]
	if !ok || label.ResourceID != resourceID {
		return nil, &domain.NotFoundError{ResourceID: labelID}
	}
	label.Value = value
	return label, nil
}

func (f *fakeLabelRepository) Delete(_ context.Context, resourceID, labelID string) error {
	label, ok := f.labels[labelID]
	if !ok || label.ResourceID != resourceID {
		return &domain.NotFoundError{ResourceID: labelID}
	}
	delete(f.labels, labelID)
	return nil
}

func TestLabelServicePolicy(t *testing.T) {
	resourceRepo := newFakeRepository()
	resourceRepo.resources["host-1"] = &domain.Resource{
		ResourceID:      "host-1",
		Category:        domain.CategoryHost,
		TenantID:        DefaultTenantID,
		NetworkDomainID: "mc-demo",
		Env:             domain.EnvPRD,
		Status:          domain.StatusOnline,
		SourceType:      domain.SourceManual,
		Attributes: domain.HostAttributes{
			Hostname: "web-01", InstanceIP: "10.0.0.1", OSType: "linux",
		},
	}
	resourceRepo.resources["app-1"] = applicationResource()
	resourceRepo.resources["app-1"].ResourceID = "app-1"
	resourceRepo.resources["app-1"].TenantID = DefaultTenantID
	resourceRepo.resources["app-1"].Status = domain.StatusOnline
	resourceRepo.resources["app-1"].SourceType = domain.SourceManual

	svc := NewLabelService(newFakeLabelRepository(), resourceRepo)
	ctx := context.Background()

	_, err := svc.Add(ctx, "host-1", "team", "infra")
	require.Error(t, err)
	var forbidden *domain.ForbiddenError
	require.ErrorAs(t, err, &forbidden)

	label, err := svc.Add(ctx, "app-1", "team", "payments")
	require.NoError(t, err)
	assert.NotEmpty(t, label.ID)

	list, err := svc.List(ctx, "app-1")
	require.NoError(t, err)
	assert.Len(t, list, 1)

	updated, err := svc.Update(ctx, "app-1", label.ID, "payments-v2")
	require.NoError(t, err)
	assert.Equal(t, "payments-v2", updated.Value)

	require.NoError(t, svc.Delete(ctx, "app-1", label.ID))
	list, err = svc.List(ctx, "app-1")
	require.NoError(t, err)
	assert.Empty(t, list)

	_, err = svc.Add(ctx, "app-1", "Bad-Key", "x")
	require.Error(t, err)
}
