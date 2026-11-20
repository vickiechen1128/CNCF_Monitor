package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// MonitorTypeRuleDTO is one derivation rule in the API payload.
type MonitorTypeRuleDTO struct {
	ID       string   `json:"id,omitempty"`
	Field    string   `json:"field"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
	Priority int      `json:"priority,omitempty"`
}

// ToDomain converts a rule payload.
func (r MonitorTypeRuleDTO) ToDomain(code string) domain.MonitorTypeRule {
	return domain.MonitorTypeRule{
		ID:              r.ID,
		MonitorTypeCode: code,
		Field:           r.Field,
		Operator:        domain.RuleOperator(r.Operator),
		Values:          append([]string(nil), r.Values...),
		Priority:        r.Priority,
	}
}

// FromMonitorTypeRule renders one rule.
func FromMonitorTypeRule(rule domain.MonitorTypeRule) MonitorTypeRuleDTO {
	return MonitorTypeRuleDTO{
		ID:       rule.ID,
		Field:    rule.Field,
		Operator: string(rule.Operator),
		Values:   append([]string(nil), rule.Values...),
		Priority: rule.Priority,
	}
}

// MonitorTypeResponse is the API view of a monitor type definition plus rules.
type MonitorTypeResponse struct {
	Code             string               `json:"code"`
	Name             string               `json:"name"`
	ResourceCategory string               `json:"resource_category"`
	RuleLogic        string               `json:"rule_logic"`
	Description      string               `json:"description,omitempty"`
	Icon             string               `json:"icon,omitempty"`
	Color            string               `json:"color,omitempty"`
	SortOrder        int                  `json:"sort_order"`
	Enabled          bool                 `json:"enabled"`
	IsBuiltin        bool                 `json:"is_builtin"`
	Rules            []MonitorTypeRuleDTO `json:"rules"`
	CreatedAt        string               `json:"created_at,omitempty"`
	UpdatedAt        string               `json:"updated_at,omitempty"`
}

// FromMonitorTypeEntry renders one definition with its rules.
func FromMonitorTypeEntry(entry domain.MonitorTypeEntry) MonitorTypeResponse {
	def := entry.Definition
	rules := make([]MonitorTypeRuleDTO, 0, len(entry.Rules))
	for _, rule := range entry.Rules {
		rules = append(rules, FromMonitorTypeRule(rule))
	}
	return MonitorTypeResponse{
		Code:             def.Code,
		Name:             def.Name,
		ResourceCategory: string(def.ResourceCategory),
		RuleLogic:        string(def.RuleLogic),
		Description:      def.Description,
		Icon:             def.Icon,
		Color:            def.Color,
		SortOrder:        def.SortOrder,
		Enabled:          def.Enabled,
		IsBuiltin:        def.IsBuiltin,
		Rules:            rules,
		CreatedAt:        formatTime(def.CreatedAt),
		UpdatedAt:        formatTime(def.UpdatedAt),
	}
}

// MonitorTypeRequest is the create/update payload (FR-21 / FR-22).
//
// “code“ is ignored on update: the code is immutable so existing jobs and
// mappings never dangle.
type MonitorTypeRequest struct {
	Code             string               `json:"code"`
	Name             string               `json:"name"`
	ResourceCategory string               `json:"resource_category"`
	RuleLogic        string               `json:"rule_logic,omitempty"`
	Description      string               `json:"description,omitempty"`
	Icon             string               `json:"icon,omitempty"`
	Color            string               `json:"color,omitempty"`
	SortOrder        int                  `json:"sort_order,omitempty"`
	Enabled          *bool                `json:"enabled,omitempty"`
	Rules            []MonitorTypeRuleDTO `json:"rules"`
}

// ToDomain converts the payload to a registry entry.
func (r MonitorTypeRequest) ToDomain(code string) domain.MonitorTypeEntry {
	if code == "" {
		code = r.Code
	}
	rules := make([]domain.MonitorTypeRule, 0, len(r.Rules))
	for _, rule := range r.Rules {
		rules = append(rules, rule.ToDomain(code))
	}
	enabled := true
	if r.Enabled != nil {
		enabled = *r.Enabled
	}
	return domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code:             code,
			Name:             r.Name,
			ResourceCategory: domain.ResourceCategory(r.ResourceCategory),
			RuleLogic:        domain.RuleLogic(r.RuleLogic),
			Description:      r.Description,
			Icon:             r.Icon,
			Color:            r.Color,
			SortOrder:        r.SortOrder,
			Enabled:          enabled,
		},
		Rules: rules,
	}
}

// ScopeFieldResponse is one entry of the rule-field whitelist.
type ScopeFieldResponse struct {
	Key        string   `json:"key"`
	Label      string   `json:"label"`
	Kind       string   `json:"kind"`
	Categories []string `json:"categories"`
}

// FromScopeFieldSpec renders one whitelist entry.
func FromScopeFieldSpec(spec domain.ScopeFieldSpec) ScopeFieldResponse {
	categories := make([]string, 0, len(spec.Categories))
	for _, category := range spec.Categories {
		categories = append(categories, string(category))
	}
	return ScopeFieldResponse{
		Key:        spec.Key,
		Label:      spec.Label,
		Kind:       string(spec.Kind),
		Categories: categories,
	}
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
