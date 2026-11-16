package service

import (
	"context"
	"fmt"
	"strings"

	"gopkg.in/yaml.v3"

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

// Create inserts a user-defined probe module.
func (s *ProbeModuleService) Create(ctx context.Context, module *domain.ProbeModule) (*domain.ProbeModule, error) {
	if module == nil {
		return nil, domain.NewValidationError("probe_module", "is required")
	}
	module.Name = strings.TrimSpace(module.Name)
	module.IsBuiltin = false
	if err := validateProbeModule(module); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, module); err != nil {
		return nil, err
	}
	return module, nil
}

// Update replaces a user-defined module. Built-in rows only allow enabling.
func (s *ProbeModuleService) Update(ctx context.Context, id string, input *domain.ProbeModule) (*domain.ProbeModule, error) {
	if input == nil {
		return nil, domain.NewValidationError("probe_module", "is required")
	}
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	input.ID = existing.ID
	input.CreatedAt = existing.CreatedAt
	input.IsBuiltin = existing.IsBuiltin
	if existing.IsBuiltin {
		if strings.TrimSpace(input.Name) != existing.Name || strings.TrimSpace(input.Content) != existing.Content {
			return nil, &domain.ForbiddenError{Message: "built-in probe modules can only be enabled or disabled"}
		}
		input.Name = existing.Name
		input.Content = existing.Content
	} else {
		input.Name = strings.TrimSpace(input.Name)
		if err := validateProbeModule(input); err != nil {
			return nil, err
		}
	}
	if err := s.repo.Update(ctx, input); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id)
}

// Delete removes an unreferenced user-defined module.
func (s *ProbeModuleService) Delete(ctx context.Context, id string) error {
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.IsBuiltin {
		return &domain.ForbiddenError{Message: "built-in probe modules cannot be deleted"}
	}
	count, err := s.jobs.CountByProbeModule(ctx, existing.Name)
	if err != nil {
		return err
	}
	if count > 0 {
		return &domain.ConflictError{
			Entity:  "probe_module",
			Message: fmt.Sprintf("probe module %q is referenced by %d scrape job(s)", existing.Name, count),
		}
	}
	return s.repo.SoftDelete(ctx, id)
}

func validateProbeModule(module *domain.ProbeModule) error {
	if module.Name == "" {
		return domain.NewValidationError("name", "is required")
	}
	if len(module.Name) > 64 {
		return domain.NewValidationError("name", "must be at most 64 characters")
	}
	var parsed map[string]any
	if err := yaml.Unmarshal([]byte(module.Content), &parsed); err != nil {
		return domain.NewValidationErrorf("content", "invalid YAML: %v", err)
	}
	if len(parsed) != 1 {
		return domain.NewValidationError("content", "must contain exactly one root module")
	}
	if _, ok := parsed[module.Name]; !ok {
		return domain.NewValidationErrorf("content", "root key must equal module name %q", module.Name)
	}
	return nil
}
