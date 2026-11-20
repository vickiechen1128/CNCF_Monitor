package domain

import (
	"regexp"
	"strings"
)

// Selector is the "which objects to collect" half of a scrape job
// (SRS Module_01 v1.5 §3.3 / FR-22).
//
// It is a pure filter: it never classifies, labels or writes back to M07. A
// job stores the selector it was saved with; changing a template never rewrites
// the stored instance snapshot.
type Selector struct {
	Logic   RuleLogic     `json:"logic"`
	Filters []ScopeFilter `json:"filters"`
}

// ScopeFilter is one compiled condition of a selector.
type ScopeFilter struct {
	Field    string       `json:"field"`
	Operator RuleOperator `json:"operator"`
	Values   []string     `json:"values,omitempty"`
}

// RuleLogic controls how a selector's conditions compose.
type RuleLogic string

// Supported selector composition modes.
const (
	// RuleLogicAll requires every condition to match (AND).
	RuleLogicAll RuleLogic = "all"
	// RuleLogicAny requires at least one condition to match (OR).
	RuleLogicAny RuleLogic = "any"
)

// Valid reports whether the logic mode is known.
func (l RuleLogic) Valid() bool {
	return l == RuleLogicAll || l == RuleLogicAny
}

// RuleOperator is a selector comparison operator.
type RuleOperator string

// Supported selector operators.
const (
	// RuleOpEq matches an exact value.
	RuleOpEq RuleOperator = "eq"
	// RuleOpContains matches a case-insensitive substring.
	RuleOpContains RuleOperator = "contains"
	// RuleOpContainsAny matches a case-insensitive substring against any value.
	RuleOpContainsAny RuleOperator = "contains_any"
	// RuleOpIn matches exact membership in the value list (OR).
	RuleOpIn RuleOperator = "in"
	// RuleOpAlways matches every resource of the category.
	RuleOpAlways RuleOperator = "always"
	// RuleOpRegexp matches a regular expression (PostgreSQL only).
	RuleOpRegexp RuleOperator = "regexp"
)

// Valid reports whether the operator is known.
func (o RuleOperator) Valid() bool {
	switch o {
	case RuleOpEq, RuleOpContains, RuleOpContainsAny, RuleOpIn, RuleOpAlways, RuleOpRegexp:
		return true
	default:
		return false
	}
}

// Empty reports whether the selector restricts nothing but the category.
func (s Selector) Empty() bool {
	return len(s.Filters) == 0
}

// Normalize trims every user-supplied value and defaults the logic to all.
func (s Selector) Normalize() Selector {
	out := Selector{Logic: s.Logic, Filters: make([]ScopeFilter, 0, len(s.Filters))}
	if out.Logic == "" {
		out.Logic = RuleLogicAll
	}
	for _, filter := range s.Filters {
		normalized := ScopeFilter{
			Field:    strings.TrimSpace(filter.Field),
			Operator: filter.Operator,
		}
		for _, value := range filter.Values {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				normalized.Values = append(normalized.Values, trimmed)
			}
		}
		if normalized.Operator == "" {
			normalized.Operator = RuleOpEq
		}
		if normalized.Operator == RuleOpAlways {
			normalized.Values = nil
		}
		out.Filters = append(out.Filters, normalized)
	}
	return out
}

// ValidateSelector checks a selector against the built-in field dictionary of
// one resource category (FR-22).
func ValidateSelector(selector Selector, category ResourceCategory) error {
	return ValidateSelectorWith(selector, category, nil)
}

// ValidateSelectorWith also accepts M07-registered custom fields. isCustomField
// reports whether a key belongs to the category's custom field dictionary; a nil
// resolver means "built-in fields only".
func ValidateSelectorWith(selector Selector, category ResourceCategory, isCustomField func(key string) bool) error {
	if !category.Valid() {
		return NewValidationErrorf("resource_category", "unknown category %q", category)
	}
	if selector.Logic == "" || !selector.Logic.Valid() {
		if selector.Logic != "" {
			return NewValidationError("selector.logic", "must be all or any")
		}
	}
	for i, filter := range selector.Filters {
		if err := validateScopeFilter(category, filter, isCustomField); err != nil {
			if validation, ok := err.(*ValidationError); ok {
				validation.Field = prefixSelectorField(i, validation.Field)
			}
			return err
		}
	}
	return nil
}

func validateScopeFilter(category ResourceCategory, filter ScopeFilter, isCustomField func(string) bool) error {
	if filter.Field == "" {
		return NewValidationError("selector.filters.field", "is required")
	}
	spec, ok := FieldSpecFor(filter.Field)
	if !ok {
		if isCustomField == nil || !isCustomField(filter.Field) {
			return NewValidationErrorf("selector.filters.field", "unknown filter field %q (allowed: %s)",
				filter.Field, strings.Join(AllowedFieldKeys(), " / "))
		}
		return validateCustomFilter(filter)
	}
	if !spec.AppliesTo(category) {
		return NewValidationErrorf("selector.filters.field",
			"field %q does not apply to resource category %q", filter.Field, category)
	}
	if !filter.Operator.Valid() {
		return NewValidationErrorf("selector.filters.operator", "unknown operator %q", filter.Operator)
	}
	if !spec.Supports(filter.Operator) {
		return NewValidationErrorf("selector.filters.operator",
			"operator %q is not supported by field %q", filter.Operator, filter.Field)
	}
	if filter.Operator == RuleOpAlways {
		if len(filter.Values) != 0 {
			return NewValidationError("selector.filters.values", "must be empty when operator is always")
		}
		return nil
	}
	if len(filter.Values) == 0 {
		return NewValidationError("selector.filters.values", "is required")
	}
	switch filter.Operator {
	case RuleOpEq, RuleOpContains, RuleOpRegexp:
		if len(filter.Values) != 1 {
			return NewValidationErrorf("selector.filters.values",
				"operator %q takes exactly one value", filter.Operator)
		}
	case RuleOpIn, RuleOpContainsAny:
		// one or more values
	}
	if filter.Operator == RuleOpRegexp {
		if _, err := regexp.Compile(filter.Values[0]); err != nil {
			return NewValidationErrorf("selector.filters.values", "invalid regular expression: %v", err)
		}
	}
	for _, value := range filter.Values {
		if err := spec.ValidateValue(value); err != nil {
			return err
		}
	}
	return nil
}

// validateCustomFilter checks operators and values of a M07 custom field. Custom
// fields are text-like; typed validation happens on the M07 write side.
func validateCustomFilter(filter ScopeFilter) error {
	if !filter.Operator.Valid() {
		return NewValidationErrorf("selector.filters.operator", "unknown operator %q", filter.Operator)
	}
	switch filter.Operator {
	case RuleOpAlways:
		if len(filter.Values) != 0 {
			return NewValidationError("selector.filters.values", "must be empty when operator is always")
		}
		return nil
	case RuleOpRegexp:
		if len(filter.Values) != 1 {
			return NewValidationErrorf("selector.filters.values", "operator %q takes exactly one value", filter.Operator)
		}
		if _, err := regexp.Compile(filter.Values[0]); err != nil {
			return NewValidationErrorf("selector.filters.values", "invalid regular expression: %v", err)
		}
		return nil
	case RuleOpEq, RuleOpContains:
		if len(filter.Values) != 1 {
			return NewValidationErrorf("selector.filters.values", "operator %q takes exactly one value", filter.Operator)
		}
		return nil
	default:
		if len(filter.Values) == 0 {
			return NewValidationError("selector.filters.values", "is required")
		}
		return nil
	}
}

func prefixSelectorField(index int, field string) string {
	if field == "" {
		return "selector.filters"
	}
	return "selector.filters[" + itoa(index) + "]." + field
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits []byte
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
