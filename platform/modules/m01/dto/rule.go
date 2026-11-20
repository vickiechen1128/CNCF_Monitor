package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// RuleRequest is the create/update payload of a monitoring rule.
type RuleRequest struct {
	Name               string            `json:"name"`
	ContentMode        string            `json:"content_mode"`
	RuleContent        string            `json:"rule_content"`
	RuleType           string            `json:"rule_type"`
	Expr               string            `json:"expr"`
	Duration           string            `json:"duration"`
	Labels             map[string]string `json:"labels"`
	Annotations        map[string]string `json:"annotations"`
	TemplateCode       string            `json:"template_code"`
	ExporterTemplateID string            `json:"exporter_template_id"`
	Scope              string            `json:"scope"`
	Enabled            *bool             `json:"enabled"`
	DraftStatus        string            `json:"draft_status"`
	AckJobRefErrors    bool              `json:"ack_job_ref_errors"`
	AckReason          string            `json:"ack_reason"`
}

// ToDomain converts the request into a domain rule.
func (r RuleRequest) ToDomain() *domain.Rule {
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	return &domain.Rule{
		Name:               r.Name,
		ContentMode:        domain.RuleContentMode(r.ContentMode),
		RuleContent:        r.RuleContent,
		RuleType:           domain.RuleType(r.RuleType),
		Expr:               r.Expr,
		Duration:           r.Duration,
		Labels:             r.Labels,
		Annotations:        r.Annotations,
		TemplateCode:       r.TemplateCode,
		ExporterTemplateID: r.ExporterTemplateID,
		Scope:              domain.RuleScope(r.Scope),
		Enabled:            enabled,
		DraftStatus:        domain.DraftStatus(r.DraftStatus),
	}
}

// RuleResponse is the v3 monitoring rule projection.
type RuleResponse struct {
	ID                 string            `json:"id"`
	Name               string            `json:"name"`
	ContentMode        string            `json:"content_mode"`
	RuleContent        string            `json:"rule_content"`
	GroupCount         int               `json:"group_count"`
	RuleCount          int               `json:"rule_count"`
	RuleType           string            `json:"rule_type"`
	Expr               string            `json:"expr"`
	Duration           string            `json:"duration"`
	Labels             map[string]string `json:"labels"`
	Annotations        map[string]string `json:"annotations"`
	TemplateCode       string            `json:"template_code"`
	ExporterTemplateID string            `json:"exporter_template_id"`
	Scope              string            `json:"scope"`
	Enabled            bool              `json:"enabled"`
	DraftStatus        string            `json:"draft_status"`
	AckJobRefErrors    bool              `json:"ack_job_ref_errors"`
	AckReason          string            `json:"ack_reason"`
	Sync               SyncResponse      `json:"sync"`
	CreatedAt          time.Time         `json:"created_at"`
	UpdatedAt          time.Time         `json:"updated_at"`
}

// FromRule maps a domain rule to the v3 projection.
func FromRule(rule *domain.Rule) RuleResponse {
	groups, rules := 0, 0
	if file, err := domain.ParseRules(rule.RuleContent); err == nil {
		groups = len(file.Groups)
		rules = file.RuleCount()
	}
	labels := rule.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	annotations := rule.Annotations
	if annotations == nil {
		annotations = map[string]string{}
	}
	return RuleResponse{
		ID:                 rule.ID,
		Name:               rule.Name,
		ContentMode:        string(rule.ContentMode),
		RuleContent:        rule.RuleContent,
		GroupCount:         groups,
		RuleCount:          rules,
		RuleType:           string(rule.RuleType),
		Expr:               rule.Expr,
		Duration:           rule.Duration,
		Labels:             labels,
		Annotations:        annotations,
		TemplateCode:       rule.TemplateCode,
		ExporterTemplateID: rule.ExporterTemplateID,
		Scope:              string(rule.Scope),
		Enabled:            rule.Enabled,
		DraftStatus:        string(rule.DraftStatus),
		AckJobRefErrors:    rule.AckJobRefErrors,
		AckReason:          rule.AckReason,
		Sync: SyncResponse{
			Status:   string(rule.Sync.Status),
			Version:  rule.Sync.Version,
			Error:    rule.Sync.Error,
			SyncedAt: rule.Sync.SyncedAt,
		},
		CreatedAt: rule.CreatedAt,
		UpdatedAt: rule.UpdatedAt,
	}
}

// RuleValidateRequest is the pre-submit validation payload.
type RuleValidateRequest struct {
	ID          string `json:"id"`
	RuleContent string `json:"rule_content"`
}

// RulePromQL is the promtool validation projection.
type RulePromQL struct {
	Status string `json:"status"`
	Error  string `json:"error"`
}

// RuleValidateResponse is the pre-submit validation result.
type RuleValidateResponse struct {
	Valid  bool                 `json:"valid"`
	Error  string               `json:"error"`
	Groups int                  `json:"groups"`
	Rules  int                  `json:"rules"`
	JobRef []domain.JobRefIssue `json:"job_ref"`
	PromQL RulePromQL           `json:"promql"`
}
