package dto

import (
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// InhibitionRequest is the create/update payload for an inhibit rule (FR-18).
type InhibitionRequest struct {
	Name           string           `json:"name"`
	SourceMatchers []domain.Matcher `json:"source_matchers"`
	TargetMatchers []domain.Matcher `json:"target_matchers"`
	Equal          []string         `json:"equal"`
	Enabled        *bool            `json:"enabled"`
}

// ToDomain converts the request into a domain rule.
func (r InhibitionRequest) ToDomain() *domain.InhibitionRule {
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	return &domain.InhibitionRule{
		Name: r.Name, SourceMatchers: r.SourceMatchers, TargetMatchers: r.TargetMatchers,
		Equal: r.Equal, Enabled: enabled,
	}
}

// InhibitionResponse is the rule projection.
type InhibitionResponse struct {
	ID             string           `json:"id"`
	Name           string           `json:"name"`
	SourceMatchers []domain.Matcher `json:"source_matchers"`
	TargetMatchers []domain.Matcher `json:"target_matchers"`
	Equal          []string         `json:"equal"`
	Enabled        bool             `json:"enabled"`
	Builtin        bool             `json:"builtin"`
}

// FromInhibition projects a rule.
func FromInhibition(rule *domain.InhibitionRule) InhibitionResponse {
	source := rule.SourceMatchers
	if source == nil {
		source = []domain.Matcher{}
	}
	target := rule.TargetMatchers
	if target == nil {
		target = []domain.Matcher{}
	}
	equal := rule.Equal
	if equal == nil {
		equal = []string{}
	}
	return InhibitionResponse{
		ID: rule.ID, Name: rule.Name, SourceMatchers: source, TargetMatchers: target,
		Equal: equal, Enabled: rule.Enabled, Builtin: rule.Builtin,
	}
}

// CreateSilenceRequest is the silence payload (FR-16). Times are RFC3339.
type CreateSilenceRequest struct {
	Matchers  []domain.Matcher `json:"matchers"`
	StartsAt  string           `json:"starts_at"`
	EndsAt    string           `json:"ends_at"`
	CreatedBy string           `json:"created_by"`
	Comment   string           `json:"comment"`
}

// LabelOption is one matcher autocomplete entry.
type LabelOption struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

// AuditResponse is one silence audit row (read-only, D50).
type AuditResponse struct {
	ID            string           `json:"id"`
	Action        string           `json:"action"`
	Result        string           `json:"result"`
	Operator      string           `json:"operator"`
	SilenceID     string           `json:"silence_id"`
	Matchers      []domain.Matcher `json:"matchers"`
	Reason        string           `json:"reason"`
	FailureReason string           `json:"failure_reason"`
	At            string           `json:"at"`
}
