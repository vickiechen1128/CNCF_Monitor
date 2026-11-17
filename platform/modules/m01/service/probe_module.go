package service

import (
	"context"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// ProbeModuleService implements blackbox probe module management (FR-11).
type ProbeModuleService struct {
	repo repository.ProbeModuleRepository
	jobs repository.JobRepository
}

// NewProbeModuleService constructs the service.
func NewProbeModuleService(repo repository.ProbeModuleRepository, jobs repository.JobRepository) *ProbeModuleService {
	return &ProbeModuleService{repo: repo, jobs: jobs}
}

// List returns a page of probe modules.
func (s *ProbeModuleService) List(ctx context.Context, filter repository.ProbeModuleFilter) ([]*domain.ProbeModule, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one probe module.
func (s *ProbeModuleService) Get(ctx context.Context, id string) (*domain.ProbeModule, error) {
	return s.repo.Get(ctx, id)
}

// ReferenceCount returns how many jobs use the module name.
func (s *ProbeModuleService) ReferenceCount(ctx context.Context, name string) (int64, error) {
	return s.jobs.CountByProbeModule(ctx, name)
}
