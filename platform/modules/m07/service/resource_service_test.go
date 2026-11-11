package service

import (
	"context"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepository struct {
	resources map[string]*domain.Resource
	conflict  bool
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{resources: map[string]*domain.Resource{}}
}

func (f *fakeRepository) Create(_ context.Context, resource *domain.Resource) error {
	if f.conflict {
		return &domain.ConflictError{DedupKey: resource.DedupKey}
	}
	f.resources[resource.ResourceID] = resource
	return nil
}

func (f *fakeRepository) Get(_ context.Context, resourceID string) (*domain.Resource, error) {
	resource, ok := f.resources[resourceID]
	if !ok {
		return nil, &domain.NotFoundError{ResourceID: resourceID}
	}
	return resource, nil
}

func (f *fakeRepository) List(_ context.Context, _ repository.ListFilter) ([]*domain.Resource, int64, error) {
	out := make([]*domain.Resource, 0, len(f.resources))
	for _, resource := range f.resources {
		out = append(out, resource)
	}
	return out, int64(len(out)), nil
}

func (f *fakeRepository) Update(_ context.Context, resource *domain.Resource) error {
	if _, ok := f.resources[resource.ResourceID]; !ok {
		return &domain.NotFoundError{ResourceID: resource.ResourceID}
	}
	f.resources[resource.ResourceID] = resource
	return nil
}

func (f *fakeRepository) SoftDelete(_ context.Context, resourceID string) error {
	if _, ok := f.resources[resourceID]; !ok {
		return &domain.NotFoundError{ResourceID: resourceID}
	}
	delete(f.resources, resourceID)
	return nil
}

func (f *fakeRepository) FindByDedupKey(_ context.Context, category domain.Category, dedupKey string) (*domain.Resource, bool, error) {
	for _, resource := range f.resources {
		if resource.Category == category && resource.DedupKey == dedupKey {
			return resource, true, nil
		}
	}
	return nil, false, nil
}

type fakeDictionary struct {
	primary string
	err     error
}

func (f *fakeDictionary) ValidateResource(_ context.Context, _ *domain.Resource) error {
	return f.err
}

func (f *fakeDictionary) PrimaryPlatformOfApp(_ context.Context, _ string) (string, bool, error) {
	if f.primary == "" {
		return "", false, nil
	}
	return f.primary, true, nil
}

func applicationResource() *domain.Resource {
	return &domain.Resource{
		Category:        domain.CategoryApplication,
		NetworkDomainID: "mc-demo",
		BizCode:         "payment",
		AppCode:         "order-service",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Attributes: domain.ApplicationAttributes{
			ServiceName:    "order-api",
			HealthCheckURL: "https://order.example.com/health",
		},
	}
}

func TestCreateDefaultsAndPlatformFallback(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	resource, err := svc.Create(context.Background(), applicationResource())
	require.NoError(t, err)

	assert.NotEmpty(t, resource.ResourceID)
	assert.Equal(t, DefaultTenantID, resource.TenantID)
	assert.Equal(t, domain.SourceManual, resource.SourceType)
	assert.Equal(t, domain.StatusOnline, resource.Status)
	assert.Equal(t, "ecommerce", resource.PlatformCode)
	assert.Equal(t, "application|mc-demo|order-api|https://order.example.com/health", resource.DedupKey)
}

func TestCreateConflict(t *testing.T) {
	repo := newFakeRepository()
	repo.conflict = true
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	_, err := svc.Create(context.Background(), applicationResource())
	require.Error(t, err)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)
}

func TestUpdatePreservesImmutableFields(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	created, err := svc.Create(context.Background(), applicationResource())
	require.NoError(t, err)

	input := applicationResource()
	input.Category = domain.CategoryHost
	_, err = svc.Update(context.Background(), created.ResourceID, input)
	require.ErrorContains(t, err, "immutable")

	input = applicationResource()
	input.Status = domain.StatusMaintenance
	input.PlatformCode = ""
	updated, err := svc.Update(context.Background(), created.ResourceID, input)
	require.NoError(t, err)
	assert.Equal(t, created.ResourceID, updated.ResourceID)
	assert.Equal(t, created.TenantID, updated.TenantID)
	assert.Equal(t, created.SourceType, updated.SourceType)
	assert.Equal(t, domain.StatusMaintenance, updated.Status)
	assert.Equal(t, "ecommerce", updated.PlatformCode)
}

func TestDeleteNotFound(t *testing.T) {
	svc := NewResourceService(newFakeRepository(), &fakeDictionary{})
	err := svc.Delete(context.Background(), "missing")
	require.Error(t, err)
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)
}
