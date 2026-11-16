package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// MappingView is one mapping plus the display names resolved from other
// modules (exporter pool, M07 label templates).
type MappingView struct {
	Mapping              *domain.Mapping
	ExporterTemplateName string
	LabelTemplateName    string
}

// MappingService implements default collection mapping use cases (FR-01/FR-03).
type MappingService struct {
	repo      repository.MappingRepository
	exporters repository.ExporterTemplateRepository
	jobs      repository.JobRepository
	labels    LabelTemplateResolver
}

// NewMappingService constructs the service. A nil label resolver falls back to
// the D-3 no-op (accept ids, no name resolution).
func NewMappingService(
	repo repository.MappingRepository,
	exporters repository.ExporterTemplateRepository,
	jobs repository.JobRepository,
	labels LabelTemplateResolver,
) *MappingService {
	if labels == nil {
		labels = NoopLabelTemplateResolver{}
	}
	return &MappingService{repo: repo, exporters: exporters, jobs: jobs, labels: labels}
}

// List returns a page of mappings with resolved display names.
func (s *MappingService) List(ctx context.Context, filter repository.MappingFilter) ([]MappingView, int64, error) {
	items, total, err := s.repo.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	views := make([]MappingView, 0, len(items))
	for _, item := range items {
		name, err := s.exporterName(ctx, item.ExporterTemplateID)
		if err != nil {
			return nil, 0, err
		}
		labelName, err := s.labelName(ctx, item.LabelTemplateID)
		if err != nil {
			return nil, 0, err
		}
		views = append(views, MappingView{Mapping: item, ExporterTemplateName: name, LabelTemplateName: labelName})
	}
	return views, total, nil
}

// Create inserts a mapping owned by the user.
func (s *MappingService) Create(ctx context.Context, input *domain.Mapping) (*MappingView, error) {
	if input == nil {
		return nil, domain.NewValidationError("mapping", "is required")
	}
	input.IsBuiltin = false
	exporter, err := s.normalizeAndValidate(ctx, input)
	if err != nil {
		return nil, err
	}
	if input.IsDefault {
		hasDefault, err := s.repo.HasDefault(ctx, input.MonitorType, "")
		if err != nil {
			return nil, err
		}
		if hasDefault {
			return nil, &domain.ConflictError{
				Entity:  "ci_exporter_mapping",
				Message: fmt.Sprintf("monitor type %q already has a default mapping", input.MonitorType),
			}
		}
	}
	if err := s.repo.Create(ctx, input); err != nil {
		return nil, err
	}
	labelName, err := s.labelName(ctx, input.LabelTemplateID)
	if err != nil {
		return nil, err
	}
	return &MappingView{Mapping: input, ExporterTemplateName: exporter.Name, LabelTemplateName: labelName}, nil
}

// Update replaces a user-owned mapping. Built-in mappings are read-only.
func (s *MappingService) Update(ctx context.Context, id string, input *domain.Mapping) (*MappingView, error) {
	if input == nil {
		return nil, domain.NewValidationError("mapping", "is required")
	}
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.IsBuiltin {
		return nil, &domain.ForbiddenError{Message: fmt.Sprintf("mapping %q is built-in and read-only", existing.ID)}
	}
	input.ID = existing.ID
	input.IsBuiltin = false
	input.LabelTemplateID = existing.LabelTemplateID
	input.CreatedAt = existing.CreatedAt
	exporter, err := s.normalizeAndValidate(ctx, input)
	if err != nil {
		return nil, err
	}
	if input.IsDefault {
		hasDefault, err := s.repo.HasDefault(ctx, input.MonitorType, existing.ID)
		if err != nil {
			return nil, err
		}
		if hasDefault {
			return nil, &domain.ConflictError{
				Entity:  "ci_exporter_mapping",
				Message: fmt.Sprintf("monitor type %q already has a default mapping", input.MonitorType),
			}
		}
	}
	if err := s.repo.Update(ctx, input); err != nil {
		return nil, err
	}
	labelName, err := s.labelName(ctx, input.LabelTemplateID)
	if err != nil {
		return nil, err
	}
	return &MappingView{Mapping: input, ExporterTemplateName: exporter.Name, LabelTemplateName: labelName}, nil
}

// Delete soft-deletes a user-owned, non-default, unreferenced mapping.
func (s *MappingService) Delete(ctx context.Context, id string) error {
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.IsBuiltin {
		return &domain.ForbiddenError{Message: fmt.Sprintf("mapping %q is built-in and cannot be deleted", existing.ID)}
	}
	if existing.IsDefault {
		return &domain.ConflictError{
			Entity:  "ci_exporter_mapping",
			Message: fmt.Sprintf("mapping %q is the default for %q; clear the default flag before deleting", existing.ID, existing.MonitorType),
		}
	}
	count, err := s.jobs.CountByMapping(ctx, existing.MonitorType, existing.ExporterTemplateID)
	if err != nil {
		return err
	}
	if count > 0 {
		return &domain.ConflictError{
			Entity:  "ci_exporter_mapping",
			Message: fmt.Sprintf("mapping for %q/%q is referenced by %d scrape job(s)", existing.MonitorType, existing.ExporterTemplateID, count),
		}
	}
	return s.repo.SoftDelete(ctx, id)
}

// SetLabelTemplate changes the mapping's label template reference (FR-03).
// It is the only write path for label_template_id.
func (s *MappingService) SetLabelTemplate(ctx context.Context, id, labelTemplateID string) (*MappingView, error) {
	existing, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	labelTemplateID = strings.TrimSpace(labelTemplateID)
	labelName := ""
	if labelTemplateID != "" {
		name, found, err := s.labels.Resolve(ctx, labelTemplateID)
		if err != nil {
			return nil, fmt.Errorf("resolve label template %q: %w", labelTemplateID, err)
		}
		if !found {
			return nil, domain.NewValidationErrorf("label_template_id", "label template %q not found", labelTemplateID)
		}
		labelName = name
	}
	existing.LabelTemplateID = labelTemplateID
	if err := s.repo.Update(ctx, existing); err != nil {
		return nil, err
	}
	exporterName, err := s.exporterName(ctx, existing.ExporterTemplateID)
	if err != nil {
		return nil, err
	}
	return &MappingView{Mapping: existing, ExporterTemplateName: exporterName, LabelTemplateName: labelName}, nil
}

func (s *MappingService) normalizeAndValidate(ctx context.Context, mapping *domain.Mapping) (*domain.ExporterTemplate, error) {
	mapping.MonitorType = strings.TrimSpace(mapping.MonitorType)
	mapping.ExporterTemplateID = strings.TrimSpace(mapping.ExporterTemplateID)
	mapping.MetricsPath = strings.TrimSpace(mapping.MetricsPath)
	if mapping.MetricsPath == "" {
		mapping.MetricsPath = domain.DefaultMetricsPath
	}
	if mapping.Scheme == "" {
		mapping.Scheme = domain.SchemeHTTP
	}
	if mapping.ScrapeInterval == "" {
		mapping.ScrapeInterval = domain.DefaultScrapeInterval
	}
	if mapping.ScrapeTimeout == "" {
		mapping.ScrapeTimeout = domain.DefaultScrapeTimeout
	}
	if mapping.MonitorType == "" {
		return nil, domain.NewValidationError("monitor_type", "is required")
	}
	if !domain.ValidMonitorType(mapping.MonitorType) {
		return nil, domain.NewValidationErrorf("monitor_type", "unknown monitor type %q", mapping.MonitorType)
	}
	if mapping.ExporterTemplateID == "" {
		return nil, domain.NewValidationError("exporter_template_id", "is required")
	}
	exporter, err := s.exporters.Get(ctx, mapping.ExporterTemplateID)
	if err != nil {
		return nil, err
	}
	if !domain.ExporterSupportsMonitorType(mapping.MonitorType, exporter.SupportedMonitorTypes) {
		return nil, domain.NewValidationErrorf("exporter_template_id",
			"exporter %q does not support monitor type %q", exporter.Name, mapping.MonitorType)
	}
	if err := domain.ValidatePort(mapping.DefaultPort); err != nil {
		return nil, err
	}
	if err := domain.ValidateMetricsPath(mapping.MetricsPath); err != nil {
		return nil, err
	}
	if !mapping.Scheme.Valid() {
		return nil, domain.NewValidationError("scheme", "must be http or https")
	}
	if err := domain.ValidateScrapeTiming(mapping.ScrapeInterval, mapping.ScrapeTimeout); err != nil {
		return nil, err
	}
	return exporter, nil
}

func (s *MappingService) exporterName(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	exporter, err := s.exporters.Get(ctx, id)
	if err != nil {
		var nf *domain.NotFoundError
		if errors.As(err, &nf) {
			return "", nil
		}
		return "", err
	}
	return exporter.Name, nil
}

func (s *MappingService) labelName(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	name, _, err := s.labels.Resolve(ctx, id)
	if err != nil {
		return "", fmt.Errorf("resolve label template %q: %w", id, err)
	}
	return name, nil
}
