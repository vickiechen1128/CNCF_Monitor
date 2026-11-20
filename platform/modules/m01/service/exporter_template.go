package service

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// ExporterTemplateService implements exporter pool use cases (FR-02).
type ExporterTemplateService struct {
	repo      repository.ExporterTemplateRepository
	templates repository.CollectionTemplateRepository
}

// NewExporterTemplateService constructs the service.
func NewExporterTemplateService(repo repository.ExporterTemplateRepository, templates repository.CollectionTemplateRepository) *ExporterTemplateService {
	return &ExporterTemplateService{repo: repo, templates: templates}
}

// List returns a page of exporter templates.
func (s *ExporterTemplateService) List(ctx context.Context, filter repository.ExporterTemplateFilter) ([]*domain.ExporterTemplate, int64, error) {
	return s.repo.List(ctx, filter)
}

// Get returns one exporter template.
func (s *ExporterTemplateService) Get(ctx context.Context, id string) (*domain.ExporterTemplate, error) {
	return s.repo.Get(ctx, id)
}

// Create inserts a user-defined exporter template.
func (s *ExporterTemplateService) Create(ctx context.Context, input *domain.ExporterTemplate) (*domain.ExporterTemplate, error) {
	if input == nil {
		return nil, domain.NewValidationError("exporter_template", "is required")
	}
	normalizeExporter(input)
	input.IsBuiltin = false
	if err := validateExporter(input); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, input); err != nil {
		return nil, err
	}
	return input, nil
}

// Update replaces a user-defined exporter template. Built-in rows are read-only.
func (s *ExporterTemplateService) Update(ctx context.Context, id string, input *domain.ExporterTemplate) (*domain.ExporterTemplate, error) {
	if input == nil {
		return nil, domain.NewValidationError("exporter_template", "is required")
	}
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.IsBuiltin {
		return nil, &domain.ForbiddenError{Message: fmt.Sprintf("exporter template %q is built-in and read-only", existing.Name)}
	}
	input.ID = existing.ID
	input.IsBuiltin = false
	input.CreatedAt = existing.CreatedAt
	normalizeExporter(input)
	if err := validateExporter(input); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, input); err != nil {
		return nil, err
	}
	return s.repo.Get(ctx, id)
}

// Delete soft-deletes a user-defined exporter template.
func (s *ExporterTemplateService) Delete(ctx context.Context, id string) error {
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.IsBuiltin {
		return &domain.ForbiddenError{Message: fmt.Sprintf("exporter template %q is built-in and cannot be deleted", existing.Name)}
	}
	count, err := s.templates.CountByExporterTemplate(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		return &domain.ConflictError{Entity: "exporter_template", Field: "id", Value: id}
	}
	return s.repo.SoftDelete(ctx, id)
}

func normalizeExporter(template *domain.ExporterTemplate) {
	template.Name = strings.TrimSpace(template.Name)
	template.Version = strings.TrimSpace(template.Version)
	template.MetricsPath = strings.TrimSpace(template.MetricsPath)
	template.OS = strings.TrimSpace(template.OS)
	template.Arch = strings.TrimSpace(template.Arch)
	template.DownloadURL = strings.TrimSpace(template.DownloadURL)
	template.Homepage = strings.TrimSpace(template.Homepage)
	if template.MetricsPath == "" {
		template.MetricsPath = domain.DefaultMetricsPath
	}
	if template.Scheme == "" {
		template.Scheme = domain.SchemeHTTP
	}
	if template.OS == "" {
		template.OS = "any"
	}
	if template.Arch == "" {
		template.Arch = "any"
	}
	if template.Source == "" {
		template.Source = domain.ExporterThirdParty
	}
}

func validateExporter(template *domain.ExporterTemplate) error {
	if template.Name == "" {
		return domain.NewValidationError("name", "is required")
	}
	if len(template.Name) > 100 {
		return domain.NewValidationError("name", "must be at most 100 characters")
	}
	if err := domain.ValidatePort(template.DefaultPort); err != nil {
		return err
	}
	if err := domain.ValidateMetricsPath(template.MetricsPath); err != nil {
		return err
	}
	if !template.Scheme.Valid() {
		return domain.NewValidationError("scheme", "must be http or https")
	}
	switch template.OS {
	case "linux", "windows", "any":
	default:
		return domain.NewValidationError("os", "must be linux, windows or any")
	}
	switch template.Arch {
	case "amd64", "arm64", "any":
	default:
		return domain.NewValidationError("arch", "must be amd64, arm64 or any")
	}
	if !template.Source.Valid() {
		return domain.NewValidationError("source", "must be official, third_party or internal")
	}
	if err := validateOptionalURL("download_url", template.DownloadURL); err != nil {
		return err
	}
	return validateOptionalURL("homepage", template.Homepage)
}

func validateOptionalURL(field, raw string) error {
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return domain.NewValidationError(field, "must be an http(s) URL")
	}
	return nil
}
