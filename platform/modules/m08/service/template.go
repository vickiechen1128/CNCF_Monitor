package service

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// TemplateService manages notification templates (FR-10).
type TemplateService struct {
	templates repository.TemplateRepository
	channels  repository.ChannelRepository
}

// NewTemplateService constructs the service.
func NewTemplateService(templates repository.TemplateRepository, channels repository.ChannelRepository) *TemplateService {
	return &TemplateService{templates: templates, channels: channels}
}

// List returns a page of templates with binding counts.
func (s *TemplateService) List(ctx context.Context, filter repository.TemplateFilter) ([]*domain.Template, int64, map[string]int64, error) {
	templates, total, err := s.templates.List(ctx, filter)
	if err != nil {
		return nil, 0, nil, err
	}
	counts := make(map[string]int64, len(templates))
	for _, template := range templates {
		count, err := s.channels.CountByTemplate(ctx, template.ID)
		if err != nil {
			return nil, 0, nil, err
		}
		counts[template.ID] = count
	}
	return templates, total, counts, nil
}

// Get loads one template with its binding count.
func (s *TemplateService) Get(ctx context.Context, id string) (*domain.Template, int64, error) {
	template, err := s.templates.Get(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	count, err := s.channels.CountByTemplate(ctx, id)
	if err != nil {
		return nil, 0, err
	}
	return template, count, nil
}

// Create validates and stores a custom template.
func (s *TemplateService) Create(ctx context.Context, template *domain.Template) (*domain.Template, error) {
	if issues := domain.ValidateTemplate(template); len(issues) > 0 {
		return nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	template.Builtin = false
	if err := s.templates.Create(ctx, template); err != nil {
		return nil, err
	}
	return template, nil
}

// Update edits a custom template; built-ins are read-only (copy them instead).
func (s *TemplateService) Update(ctx context.Context, id string, patch *domain.Template) (*domain.Template, error) {
	existing, err := s.templates.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.Builtin {
		return nil, &domain.ForbiddenError{Message: "内置模板只读，请先复制为自定义模板再编辑"}
	}
	patch.ID = id
	patch.Builtin = false
	if patch.ChannelType == "" {
		patch.ChannelType = existing.ChannelType
	}
	if issues := domain.ValidateTemplate(patch); len(issues) > 0 {
		return nil, &domain.ValidationError{Field: issues[0].Field, Message: issues[0].Message}
	}
	if err := s.templates.Update(ctx, patch); err != nil {
		return nil, err
	}
	return patch, nil
}

// Delete removes a custom template that no channel binds.
func (s *TemplateService) Delete(ctx context.Context, id string) error {
	existing, err := s.templates.Get(ctx, id)
	if err != nil {
		return err
	}
	if existing.Builtin {
		return &domain.ForbiddenError{Message: "内置模板不可删除"}
	}
	count, err := s.channels.CountByTemplate(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		return &domain.ConflictError{Message: fmt.Sprintf("模板仍被 %d 个通知渠道绑定，请先解绑后再删除", count)}
	}
	return s.templates.SoftDelete(ctx, id)
}
