package dto

import (
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// SelectorFilterDTO is one condition of a job selector.
type SelectorFilterDTO struct {
	Field    string   `json:"field"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
}

// ToDomain converts a condition payload.
func (f SelectorFilterDTO) ToDomain() domain.ScopeFilter {
	return domain.ScopeFilter{
		Field:    f.Field,
		Operator: domain.RuleOperator(f.Operator),
		Values:   append([]string(nil), f.Values...),
	}
}

// FromScopeFilter renders one condition.
func FromScopeFilter(filter domain.ScopeFilter) SelectorFilterDTO {
	return SelectorFilterDTO{
		Field:    filter.Field,
		Operator: string(filter.Operator),
		Values:   append([]string(nil), filter.Values...),
	}
}

// SelectorDTO is the "which objects to collect" payload of a job (FR-22).
type SelectorDTO struct {
	Logic   string              `json:"logic"`
	Filters []SelectorFilterDTO `json:"filters"`
}

// ToDomain converts the selector payload.
func (s SelectorDTO) ToDomain() domain.Selector {
	selector := domain.Selector{Logic: domain.RuleLogic(s.Logic)}
	for _, filter := range s.Filters {
		selector.Filters = append(selector.Filters, filter.ToDomain())
	}
	return selector
}

// FromSelector renders a selector.
func FromSelector(selector domain.Selector) SelectorDTO {
	logic := string(selector.Logic)
	if logic == "" {
		logic = string(domain.RuleLogicAll)
	}
	filters := make([]SelectorFilterDTO, 0, len(selector.Filters))
	for _, filter := range selector.Filters {
		filters = append(filters, FromScopeFilter(filter))
	}
	return SelectorDTO{Logic: logic, Filters: filters}
}

// CollectionTemplateResponse is the v3 template projection (FR-21).
type CollectionTemplateResponse struct {
	Code                 string      `json:"code"`
	Name                 string      `json:"name"`
	ResourceCategory     string      `json:"resource_category"`
	ExporterTemplateID   string      `json:"exporter_template_id"`
	ExporterTemplateName string      `json:"exporter_template_name,omitempty"`
	DefaultPort          int         `json:"default_port"`
	MetricsPath          string      `json:"metrics_path"`
	Scheme               string      `json:"scheme"`
	ScrapeInterval       string      `json:"scrape_interval"`
	ScrapeTimeout        string      `json:"scrape_timeout"`
	LabelTemplateID      string      `json:"label_template_id"`
	LabelTemplateName    string      `json:"label_template_name,omitempty"`
	DefaultSelector      SelectorDTO `json:"default_selector"`
	Description          string      `json:"description,omitempty"`
	SortOrder            int         `json:"sort_order"`
	Enabled              bool        `json:"enabled"`
	IsBuiltin            bool        `json:"is_builtin"`
	ReferenceJobCount    int64       `json:"reference_job_count"`
	CreatedAt            string      `json:"created_at,omitempty"`
	UpdatedAt            string      `json:"updated_at,omitempty"`
}

// FromCollectionTemplate renders a template plus resolved display names.
func FromCollectionTemplate(t *domain.CollectionTemplate, exporterName, labelName string, jobCount int64) CollectionTemplateResponse {
	return CollectionTemplateResponse{
		Code:                 t.Code,
		Name:                 t.Name,
		ResourceCategory:     string(t.ResourceCategory),
		ExporterTemplateID:   t.ExporterTemplateID,
		ExporterTemplateName: exporterName,
		DefaultPort:          t.DefaultPort,
		MetricsPath:          t.MetricsPath,
		Scheme:               string(t.Scheme),
		ScrapeInterval:       t.ScrapeInterval,
		ScrapeTimeout:        t.ScrapeTimeout,
		LabelTemplateID:      t.LabelTemplateID,
		LabelTemplateName:    labelName,
		DefaultSelector:      FromSelector(t.DefaultSelector),
		Description:          t.Description,
		SortOrder:            t.SortOrder,
		Enabled:              t.Enabled,
		IsBuiltin:            t.IsBuiltin,
		ReferenceJobCount:    jobCount,
		CreatedAt:            formatTime(t.CreatedAt),
		UpdatedAt:            formatTime(t.UpdatedAt),
	}
}

// CollectionTemplateRequest is the create/update payload (FR-21).
//
// "code" is ignored on update: the code is immutable so existing jobs and metric
// anchors never dangle.
type CollectionTemplateRequest struct {
	Code               string       `json:"code"`
	Name               string       `json:"name"`
	ResourceCategory   string       `json:"resource_category"`
	ExporterTemplateID string       `json:"exporter_template_id"`
	DefaultPort        int          `json:"default_port"`
	MetricsPath        string       `json:"metrics_path"`
	Scheme             string       `json:"scheme"`
	ScrapeInterval     string       `json:"scrape_interval"`
	ScrapeTimeout      string       `json:"scrape_timeout"`
	LabelTemplateID    string       `json:"label_template_id"`
	DefaultSelector    *SelectorDTO `json:"default_selector,omitempty"`
	Description        string       `json:"description"`
	SortOrder          int          `json:"sort_order"`
	Enabled            *bool        `json:"enabled"`
}

// ToDomain converts the payload into a domain template.
func (r CollectionTemplateRequest) ToDomain(code string) domain.CollectionTemplate {
	if code == "" {
		code = r.Code
	}
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	template := domain.CollectionTemplate{
		Code:               code,
		Name:               r.Name,
		ResourceCategory:   domain.ResourceCategory(r.ResourceCategory),
		ExporterTemplateID: r.ExporterTemplateID,
		DefaultPort:        r.DefaultPort,
		MetricsPath:        r.MetricsPath,
		Scheme:             domain.Scheme(r.Scheme),
		ScrapeInterval:     r.ScrapeInterval,
		ScrapeTimeout:      r.ScrapeTimeout,
		LabelTemplateID:    r.LabelTemplateID,
		Description:        r.Description,
		SortOrder:          r.SortOrder,
		Enabled:            enabled,
	}
	if r.DefaultSelector != nil {
		template.DefaultSelector = r.DefaultSelector.ToDomain()
	}
	return template
}

// CandidateFieldResponse is one entry of the selector field dictionary.
//
// Custom fields (registered through M07's CI model page) are flagged so the UI
// can group them; physical columns are never exposed.
type CandidateFieldResponse struct {
	Key        string   `json:"key"`
	Label      string   `json:"label"`
	Kind       string   `json:"kind"`
	Categories []string `json:"categories"`
	Custom     bool     `json:"custom"`
}

// FromFieldSpec renders one built-in dictionary entry.
func FromFieldSpec(spec domain.FieldSpec) CandidateFieldResponse {
	categories := make([]string, 0, len(spec.Categories))
	for _, category := range spec.Categories {
		categories = append(categories, string(category))
	}
	return CandidateFieldResponse{
		Key:        spec.Key,
		Label:      spec.Label,
		Kind:       string(spec.Kind),
		Categories: categories,
		Custom:     false,
	}
}

// NewCustomFieldResponse renders one M07-registered custom field.
func NewCustomFieldResponse(key, label, kind, category string) CandidateFieldResponse {
	return CandidateFieldResponse{
		Key:        key,
		Label:      label,
		Kind:       kind,
		Categories: []string{category},
		Custom:     true,
	}
}

// TemplateImpactResponse is the change-impact preview payload (FR-24).
type TemplateImpactResponse struct {
	Code          string `json:"code"`
	ReferenceJobs int64  `json:"reference_jobs"`
	MetricAnchors int64  `json:"metric_anchors"`
	MatchedCount  int64  `json:"matched_resources,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
}
