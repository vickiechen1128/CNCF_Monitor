package service

import (
	"context"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stub repos embed the interfaces so only the methods exercised by the tests
// need an implementation; unimplemented methods are never called.
type stubDomainRepo struct {
	repository.NetworkDomainRepository
	deleted bool
}

func (f *stubDomainRepo) Get(context.Context, string) (*domain.NetworkDomain, error) {
	return &domain.NetworkDomain{ID: "mc-demo", Status: domain.DomainStatusEnabled}, nil
}
func (f *stubDomainRepo) Delete(context.Context, string) error { f.deleted = true; return nil }
func (f *stubDomainRepo) UpdateStatus(context.Context, string, domain.DomainStatus) error {
	return nil
}

type stubM07Reader struct {
	count int64
}

func (f *stubM07Reader) CountByDomain(context.Context, string) (int64, error) { return f.count, nil }
func (f *stubM07Reader) SamplesByDomain(context.Context, string, int) ([]domain.ResourceSummary, error) {
	return nil, nil
}

type stubScrapeJobCounter struct {
	count int64
}

func (f *stubScrapeJobCounter) CountByDomain(context.Context, string) (int64, error) {
	return f.count, nil
}

func TestImpactIncludesScrapeJobCount(t *testing.T) {
	svc := NewNetworkDomainService(
		&stubDomainRepo{},
		nil,
		&stubM07Reader{count: 3},
		references.NoopMonitoring{},
		&stubScrapeJobCounter{count: 2},
	)
	impact, err := svc.Impact(context.Background(), "mc-demo")
	require.NoError(t, err)
	assert.EqualValues(t, 3, impact.ResourceCount)
	assert.EqualValues(t, 2, impact.ScrapeJobCount)
}

func TestDeleteRejectedByScrapeJobs(t *testing.T) {
	repo := &stubDomainRepo{}
	svc := NewNetworkDomainService(
		repo,
		nil,
		&stubM07Reader{count: 0},
		references.NoopMonitoring{},
		&stubScrapeJobCounter{count: 2},
	)
	_, err := svc.Delete(context.Background(), "mc-demo")
	require.Error(t, err)
	var inUse *domain.DomainInUseError
	require.ErrorAs(t, err, &inUse)
	assert.EqualValues(t, 2, inUse.Impact.ScrapeJobCount)
	assert.Contains(t, err.Error(), "2 scrape job(s)")
	assert.False(t, repo.deleted, "有 job 引用时不得执行删除")

	// No references at all -> deletion proceeds.
	repo2 := &stubDomainRepo{}
	svc2 := NewNetworkDomainService(
		repo2, nil, &stubM07Reader{count: 0},
		references.NoopMonitoring{}, references.NoopScrapeJobCounter{},
	)
	_, err = svc2.Delete(context.Background(), "mc-demo")
	require.NoError(t, err)
	assert.True(t, repo2.deleted)
}
