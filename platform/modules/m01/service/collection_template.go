package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// CollectionTemplateView is one template plus the display names resolved from
// other modules (exporter pool, M07 label templates) and its reference count.
type CollectionTemplateView struct {
	Template             *domain.CollectionTemplate
	ExporterTemplateName string
	LabelTemplateName    string
	JobCount             int64
}

// CollectionTemplateService implements collection template use cases
// (SRS Module_01 v1.5 FR-21 / FR-24).
//
// A template is the only "type-like" object in M01: one exporter, one parameter
// set, one label template. It deliberately carries no scope — the scrape job
// selector owns that (FR-22) — so the retired monitor-object-type layer cannot
// come back under another name.
type CollectionTemplateService struct {
	repo      repository.CollectionTemplateRepository
	exporters repository.ExporterTemplateRepository
	labels    LabelTemplateResolver
}

// NewCollectionTemplateService constructs the service.
func NewCollectionTemplateService(
	repo repository.CollectionTemplateRepository,
	exporters repository.ExporterTemplateRepository,
	labels LabelTemplateResolver,
) *CollectionTemplateService {
	if labels == nil {
		labels = NoopLabelTemplateResolver{}
	}
	return &CollectionTemplateService{repo: repo, exporters: exporters, labels: labels}
}

// List returns a page of templates with resolved names and job counts.
func (s *CollectionTemplateService) List(ctx context.Context, filter repository.TemplateFilter) ([]CollectionTemplateView, int64, error) {
	items, total, err := s.repo.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	views := make([]CollectionTemplateView, 0, len(items))
	for _, item := range items {
		view, err := s.view(ctx, item)
		if err != nil {
			return nil, 0, err
		}
		views = append(views, *view)
	}
	return views, total, nil
}

// Get loads one template with resolved names and reference counts.
func (s *CollectionTemplateService) Get(ctx context.Context, code string) (*CollectionTemplateView, error) {
	template, err := s.repo.Get(ctx, strings.TrimSpace(code))
	if err != nil {
		return nil, err
	}
	return s.view(ctx, template)
}

// Catalog resolves the template and its exporter for job validation.
func (s *CollectionTemplateService) Catalog(ctx context.Context, code string) (*domain.CollectionTemplate, *domain.ExporterTemplate, error) {
	template, err := s.repo.Get(ctx, strings.TrimSpace(code))
	if err != nil {
		return nil, nil, err
	}
	if template.ExporterTemplateID == "" {
		return nil, nil, domain.NewValidationErrorf("template_code",
			"collection template %q has no exporter bound yet", template.Code)
	}
	exporter, err := s.exporters.Get(ctx, template.ExporterTemplateID)
	if err != nil {
		return nil, nil, fmt.Errorf("resolve exporter of template %q: %w", template.Code, err)
	}
	return template, exporter, nil
}

// Create registers a user-owned template. Built-in templates come from seeds.
func (s *CollectionTemplateService) Create(ctx context.Context, template *domain.CollectionTemplate) (*CollectionTemplateView, error) {
	if template == nil {
		return nil, domain.NewValidationError("template", "is required")
	}
	domain.NormalizeCollectionTemplate(template)
	template.IsBuiltin = false
	if err := s.validate(ctx, template); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, template); err != nil {
		return nil, err
	}
	return s.Get(ctx, template.Code)
}

// Update replaces the mutable template fields. Built-in templates are editable
// by platform administrators only and can never be deleted (FR-21 / FR-24).
func (s *CollectionTemplateService) Update(ctx context.Context, code string, template *domain.CollectionTemplate) (*CollectionTemplateView, error) {
	if template == nil {
		return nil, domain.NewValidationError("template", "is required")
	}
	code = strings.TrimSpace(code)
	existing, err := s.repo.Get(ctx, code)
	if err != nil {
		return nil, err
	}
	if err := requireAdminForBuiltin(ctx, existing.IsBuiltin); err != nil {
		return nil, err
	}
	template.Code = code
	template.IsBuiltin = existing.IsBuiltin
	template.CreatedAt = existing.CreatedAt
	domain.NormalizeCollectionTemplate(template)
	if err := s.validate(ctx, template); err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, template); err != nil {
		return nil, err
	}
	return s.Get(ctx, code)
}

// Delete removes a user-owned template with no live references.
func (s *CollectionTemplateService) Delete(ctx context.Context, code string) error {
	code = strings.TrimSpace(code)
	existing, err := s.repo.Get(ctx, code)
	if err != nil {
		return err
	}
	if existing.IsBuiltin {
		return &domain.ForbiddenError{
			Message: fmt.Sprintf("collection template %q is built in and can only be disabled", code),
		}
	}
	if err := requireAdminForBuiltin(ctx, false); err != nil {
		return err
	}
	counts, err := s.repo.CountReferences(ctx, code)
	if err != nil {
		return err
	}
	if counts.Total() > 0 {
		return &domain.ConflictError{
			Entity: "collection_template",
			Field:  "code",
			Value:  code,
			Message: fmt.Sprintf(
				"collection template %q is still referenced (jobs=%d, metric_anchors=%d)",
				code, counts.Jobs, counts.MetricAnchors),
		}
	}
	return s.repo.SoftDelete(ctx, code)
}

// Impact reports the stored references (FR-24).
func (s *CollectionTemplateService) Impact(ctx context.Context, code string) (repository.TemplateReferenceCounts, domain.CollectionTemplate, error) {
	template, err := s.repo.Get(ctx, strings.TrimSpace(code))
	if err != nil {
		return repository.TemplateReferenceCounts{}, domain.CollectionTemplate{}, err
	}
	counts, err := s.repo.CountReferences(ctx, code)
	if err != nil {
		return repository.TemplateReferenceCounts{}, domain.CollectionTemplate{}, err
	}
	return counts, *template, nil
}

// EnsureBuiltins inserts any missing built-in template (FR-21 idempotent seed).
//
// It never overwrites a user edit: existing rows, including disabled ones, are
// left untouched.
func (s *CollectionTemplateService) EnsureBuiltins(ctx context.Context) error {
	for _, seed := range domain.BuiltinCollectionTemplates() {
		if _, found, err := s.repo.Find(ctx, seed.Code); err != nil {
			return err
		} else if found {
			continue
		}
		template := seed
		if template.ExporterTemplateID == "" {
			// No built-in implementation is registered for this recipe yet: keep
			// it visible but unusable until an administrator binds an exporter.
			template.Enabled = false
		}
		if err := s.repo.Create(ctx, &template); err != nil {
			return fmt.Errorf("create built-in collection template %q: %w", seed.Code, err)
		}
	}
	return nil
}

func (s *CollectionTemplateService) view(ctx context.Context, template *domain.CollectionTemplate) (*CollectionTemplateView, error) {
	exporterName, err := s.exporterName(ctx, template.ExporterTemplateID)
	if err != nil {
		return nil, err
	}
	labelName, err := s.labelName(ctx, template.LabelTemplateID)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.CountReferences(ctx, template.Code)
	if err != nil {
		return nil, err
	}
	return &CollectionTemplateView{
		Template:             template,
		ExporterTemplateName: exporterName,
		LabelTemplateName:    labelName,
		JobCount:             counts.Jobs,
	}, nil
}

func (s *CollectionTemplateService) validate(ctx context.Context, template *domain.CollectionTemplate) error {
	if err := domain.ValidateCollectionTemplate(*template); err != nil {
		return err
	}
	if template.ExporterTemplateID == "" {
		return domain.NewValidationError("exporter_template_id", "is required")
	}
	if _, err := s.exporters.Get(ctx, template.ExporterTemplateID); err != nil {
		return err
	}
	if template.LabelTemplateID != "" {
		ref, found, err := s.labels.Resolve(ctx, template.LabelTemplateID)
		if err != nil {
			return fmt.Errorf("resolve label template %q: %w", template.LabelTemplateID, err)
		}
		if !found {
			return domain.NewValidationErrorf("label_template_id",
				"label template %q not found", template.LabelTemplateID)
		}
		if ref.Category != "" && ref.Category != string(template.ResourceCategory) {
			return domain.NewValidationErrorf("label_template_id",
				"label template category %q does not match template category %q",
				ref.Category, template.ResourceCategory)
		}
	}
	return nil
}

func (s *CollectionTemplateService) exporterName(ctx context.Context, id string) (string, error) {
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

func (s *CollectionTemplateService) labelName(ctx context.Context, id string) (string, error) {
	if id == "" {
		return "", nil
	}
	ref, _, err := s.labels.Resolve(ctx, id)
	if err != nil {
		return "", fmt.Errorf("resolve label template %q: %w", id, err)
	}
	return ref.Name, nil
}

// requireAdminForBuiltin forbids non-administrators from mutating built-in
// templates (FR-29). Anonymous contexts are treated as non-admin (fail closed).
func requireAdminForBuiltin(ctx context.Context, builtin bool) error {
	if !builtin {
		return nil
	}
	if actor, ok := ActorFrom(ctx); ok && actor.IsPlatformAdmin {
		return nil
	}
	return &domain.ForbiddenError{
		Message: "built-in collection templates can only be edited by a platform administrator",
	}
}
