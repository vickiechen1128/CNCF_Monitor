// Package domain contains the Module 01 v3 domain model.
//
// This file implements the configurable monitor-object-type registry added by
// SRS Module_01 v1.3 §3.1 / §5.6 (FR-21 ~ FR-24). A monitor type used to be a
// Go enum; it is now a definition row plus derivation rules that explain how to
// recognise the type from M07 resource attributes.
package domain

import (
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// RuleLogic controls how a type's rules compose.
type RuleLogic string

// Supported rule composition modes.
const (
	// RuleLogicAll requires every rule to match (AND).
	RuleLogicAll RuleLogic = "all"
	// RuleLogicAny requires at least one rule to match (OR).
	RuleLogicAny RuleLogic = "any"
)

// Valid reports whether the logic mode is known.
func (l RuleLogic) Valid() bool {
	return l == RuleLogicAll || l == RuleLogicAny
}

// RuleOperator is a derivation-rule comparison operator.
type RuleOperator string

// Supported derivation-rule operators.
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

// MonitorTypeDefinition is one configurable monitor object type (FR-21).
type MonitorTypeDefinition struct {
	Code             string
	Name             string
	ResourceCategory ResourceCategory
	RuleLogic        RuleLogic
	Description      string
	Icon             string
	Color            string
	SortOrder        int
	Enabled          bool
	IsBuiltin        bool
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// MonitorTypeRule is one derivation rule of a monitor type (FR-22).
type MonitorTypeRule struct {
	ID              string
	MonitorTypeCode string
	Field           string
	Operator        RuleOperator
	Values          []string
	Priority        int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// MonitorTypeEntry is a definition together with its rules.
type MonitorTypeEntry struct {
	Definition MonitorTypeDefinition
	Rules      []MonitorTypeRule
}

// ScopeFilter is one compiled rule ready for the candidate query builder.
type ScopeFilter struct {
	Field    string
	Operator RuleOperator
	Values   []string
}

// MonitorTypeScope is the resolved candidate scope of a monitor type: the M07
// resource category plus the filters that select its members.
//
// The scope is derived, never stored on the resource: one resource may match
// several scopes at once, which is what allows a single CI to be collected by
// several exporters (FR-23).
type MonitorTypeScope struct {
	Code     string
	Category ResourceCategory
	Logic    RuleLogic
	Filters  []ScopeFilter
}

// MonitorTypeRegistry is an immutable snapshot of all known types.
//
// It is safe for concurrent reads and cheap to swap atomically, so the HTTP
// layer installs a fresh snapshot after every write instead of invalidating a
// cache lazily (NFR-11).
type MonitorTypeRegistry struct {
	entries map[string]MonitorTypeEntry
}

// NewMonitorTypeRegistry builds a registry snapshot from entries.
func NewMonitorTypeRegistry(entries []MonitorTypeEntry) *MonitorTypeRegistry {
	byCode := make(map[string]MonitorTypeEntry, len(entries))
	for _, entry := range entries {
		rules := append([]MonitorTypeRule(nil), entry.Rules...)
		sort.SliceStable(rules, func(i, j int) bool {
			if rules[i].Priority != rules[j].Priority {
				return rules[i].Priority < rules[j].Priority
			}
			return rules[i].ID < rules[j].ID
		})
		entry.Rules = rules
		byCode[entry.Definition.Code] = entry
	}
	return &MonitorTypeRegistry{entries: byCode}
}

// legacyMonitorTypeAliases maps pre-v1.3 codes to their current code.
//
// npu became host_npu when NPU was re-modelled as a host capability that is
// orthogonal to the operating system. Old rows are migrated by 0021; the alias
// keeps stale API clients and exported files working.
var legacyMonitorTypeAliases = map[string]string{
	"npu": MonitorTypeHostNPU,
}

// NormalizeMonitorTypeCode resolves a legacy code to the current one.
func NormalizeMonitorTypeCode(code string) string {
	trimmed := strings.TrimSpace(code)
	if alias, ok := legacyMonitorTypeAliases[trimmed]; ok {
		return alias
	}
	return trimmed
}

// Get returns one entry. Legacy codes are accepted and resolved to the current
// definition so an old client cannot silently lose its monitor type.
func (r *MonitorTypeRegistry) Get(code string) (MonitorTypeEntry, bool) {
	if r == nil {
		return MonitorTypeEntry{}, false
	}
	entry, ok := r.entries[NormalizeMonitorTypeCode(code)]
	return entry, ok
}

// Valid reports whether the type exists and is enabled.
func (r *MonitorTypeRegistry) Valid(code string) bool {
	entry, ok := r.Get(code)
	return ok && entry.Definition.Enabled
}

// CategoryOf maps a type back to its M07 resource category.
func (r *MonitorTypeRegistry) CategoryOf(code string) (ResourceCategory, bool) {
	entry, ok := r.Get(code)
	if !ok {
		return "", false
	}
	return entry.Definition.ResourceCategory, true
}

// Scope resolves the candidate query scope of a type.
func (r *MonitorTypeRegistry) Scope(code string) (MonitorTypeScope, bool) {
	entry, ok := r.Get(code)
	if !ok || !entry.Definition.Enabled {
		return MonitorTypeScope{}, false
	}
	scope := MonitorTypeScope{
		Code:     entry.Definition.Code,
		Category: entry.Definition.ResourceCategory,
		Logic:    entry.Definition.RuleLogic,
		Filters:  make([]ScopeFilter, 0, len(entry.Rules)),
	}
	for _, rule := range entry.Rules {
		scope.Filters = append(scope.Filters, ScopeFilter{
			Field:    rule.Field,
			Operator: rule.Operator,
			Values:   append([]string(nil), rule.Values...),
		})
	}
	return scope, true
}

// All returns every entry ordered by category, sort order and code.
func (r *MonitorTypeRegistry) All() []MonitorTypeEntry {
	if r == nil {
		return nil
	}
	out := make([]MonitorTypeEntry, 0, len(r.entries))
	for _, entry := range r.entries {
		out = append(out, entry)
	}
	sortMonitorTypeEntries(out)
	return out
}

// ForCategory returns the entries of one resource category.
func (r *MonitorTypeRegistry) ForCategory(category ResourceCategory) []MonitorTypeEntry {
	out := make([]MonitorTypeEntry, 0, len(r.entries))
	for _, entry := range r.All() {
		if entry.Definition.ResourceCategory == category {
			out = append(out, entry)
		}
	}
	return out
}

func sortMonitorTypeEntries(entries []MonitorTypeEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		left, right := entries[i].Definition, entries[j].Definition
		if left.ResourceCategory != right.ResourceCategory {
			return left.ResourceCategory < right.ResourceCategory
		}
		if left.SortOrder != right.SortOrder {
			return left.SortOrder < right.SortOrder
		}
		return left.Code < right.Code
	})
}

// MonitorTypeRegistryHolder swaps registry snapshots for the whole process.
type MonitorTypeRegistryHolder struct {
	mu       sync.RWMutex
	registry *MonitorTypeRegistry
}

// NewMonitorTypeRegistryHolder builds a holder seeded with the built-in types.
func NewMonitorTypeRegistryHolder() *MonitorTypeRegistryHolder {
	return &MonitorTypeRegistryHolder{registry: NewMonitorTypeRegistry(BuiltinMonitorTypeEntries())}
}

// Current returns the active snapshot.
func (h *MonitorTypeRegistryHolder) Current() *MonitorTypeRegistry {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.registry
}

// Install replaces the active snapshot.
func (h *MonitorTypeRegistryHolder) Install(registry *MonitorTypeRegistry) {
	if registry == nil {
		return
	}
	h.mu.Lock()
	h.registry = registry
	h.mu.Unlock()
}

var (
	sharedRegistryMu     sync.RWMutex
	sharedMonitorTypes   = NewMonitorTypeRegistryHolder()
	monitorTypeCodeRegex = regexp.MustCompile(`^[a-z][a-z0-9_]{1,63}$`)
)

// ActiveMonitorTypeRegistry returns the process-wide monitor type snapshot.
//
// It defaults to the built-in types so unit tests and read paths keep working
// before the M01 module boots and installs the database-backed snapshot.
func ActiveMonitorTypeRegistry() *MonitorTypeRegistry {
	sharedRegistryMu.RLock()
	holder := sharedMonitorTypes
	sharedRegistryMu.RUnlock()
	return holder.Current()
}

// InstallMonitorTypeRegistry replaces the process-wide monitor type snapshot.
func InstallMonitorTypeRegistry(registry *MonitorTypeRegistry) {
	sharedRegistryMu.RLock()
	holder := sharedMonitorTypes
	sharedRegistryMu.RUnlock()
	holder.Install(registry)
}

// ResetMonitorTypeRegistry restores the built-in snapshot (tests only).
func ResetMonitorTypeRegistry() {
	InstallMonitorTypeRegistry(NewMonitorTypeRegistry(BuiltinMonitorTypeEntries()))
}

// ValidateMonitorTypeCode checks the code shape used by API and seed data.
func ValidateMonitorTypeCode(code string) error {
	if !monitorTypeCodeRegex.MatchString(code) {
		return NewValidationErrorf("code",
			"must match %s (lowercase letters, digits and underscore)", monitorTypeCodeRegex.String())
	}
	return nil
}

// ValidateMonitorTypeEntry validates a definition together with its rules.
func ValidateMonitorTypeEntry(definition MonitorTypeDefinition, rules []MonitorTypeRule) error {
	if err := ValidateMonitorTypeCode(strings.TrimSpace(definition.Code)); err != nil {
		return err
	}
	if strings.TrimSpace(definition.Name) == "" {
		return NewValidationError("name", "is required")
	}
	if !definition.ResourceCategory.Valid() {
		return NewValidationErrorf("resource_category", "unknown category %q", definition.ResourceCategory)
	}
	if definition.RuleLogic == "" {
		definition.RuleLogic = RuleLogicAll
	}
	if !definition.RuleLogic.Valid() {
		return NewValidationError("rule_logic", "must be all or any")
	}
	if len(rules) == 0 {
		return NewValidationError("rules", "at least one derivation rule is required")
	}
	for i, rule := range rules {
		if err := ValidateMonitorTypeRule(definition, rule); err != nil {
			if validation, ok := err.(*ValidationError); ok {
				validation.Field = prefixRuleField(i, validation.Field)
			}
			return err
		}
	}
	return nil
}

func prefixRuleField(index int, field string) string {
	if field == "" {
		return "rules"
	}
	return "rules[" + itoa(index) + "]." + field
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

// ValidateMonitorTypeRule validates one rule against its definition.
//
// The field must come from the server-owned scope-field whitelist and must
// apply to the definition's resource category: user input never names a
// physical column (NFR-11, FR-22).
func ValidateMonitorTypeRule(definition MonitorTypeDefinition, rule MonitorTypeRule) error {
	field := strings.TrimSpace(rule.Field)
	if field == "" {
		return NewValidationError("field", "is required")
	}
	spec, ok := ScopeFieldSpecFor(field)
	if !ok {
		return NewValidationErrorf("field", "unknown scope field %q (allowed: %s)",
			field, strings.Join(AllowedScopeFieldKeys(), " / "))
	}
	if !spec.AppliesTo(definition.ResourceCategory) {
		return NewValidationErrorf("field",
			"field %q does not apply to resource category %q", field, definition.ResourceCategory)
	}
	if !rule.Operator.Valid() {
		return NewValidationErrorf("operator", "unknown operator %q", rule.Operator)
	}
	if !spec.Supports(rule.Operator) {
		return NewValidationErrorf("operator",
			"operator %q is not supported by field %q", rule.Operator, field)
	}
	values := normalizeRuleValues(rule.Values)
	if rule.Operator == RuleOpAlways {
		if len(values) != 0 {
			return NewValidationError("values", "must be empty when operator is always")
		}
		return nil
	}
	if len(values) == 0 {
		return NewValidationError("values", "is required")
	}
	switch rule.Operator {
	case RuleOpEq, RuleOpContains, RuleOpRegexp:
		if len(values) != 1 {
			return NewValidationErrorf("values", "operator %q takes exactly one value", rule.Operator)
		}
	case RuleOpIn, RuleOpContainsAny:
		// one or more values
	}
	if rule.Operator == RuleOpRegexp {
		if _, err := regexp.Compile(values[0]); err != nil {
			return NewValidationErrorf("values", "invalid regular expression: %v", err)
		}
	}
	for _, value := range values {
		if err := spec.ValidateValue(value); err != nil {
			return err
		}
	}
	return nil
}

func normalizeRuleValues(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}
