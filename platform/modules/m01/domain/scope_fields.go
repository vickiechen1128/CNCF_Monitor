package domain

import (
	"strings"
)

// ScopeFieldKind classifies a derivation-rule field.
type ScopeFieldKind string

// Supported scope field kinds.
const (
	// ScopeFieldText is a free-text attribute matched by string operators.
	ScopeFieldText ScopeFieldKind = "text"
	// ScopeFieldBoolean is a boolean capability flag.
	ScopeFieldBoolean ScopeFieldKind = "boolean"
	// ScopeFieldOSFamily is a virtual field that expands to OS dictionary
	// keywords, so ``os_family = linux`` keeps matching canonical OS names such
	// as "Ubuntu" or "RedHat Enterprise Linux".
	ScopeFieldOSFamily ScopeFieldKind = "os_family"
)

// ScopeFieldSpec describes one field a derivation rule may reference.
//
// The spec is the server-owned whitelist behind FR-22 / NFR-11: callers send a
// field KEY, never a physical column, and the query builder owns the mapping.
type ScopeFieldSpec struct {
	Key        string
	Label      string
	Kind       ScopeFieldKind
	Column     string
	Categories []ResourceCategory
}

// AppliesTo reports whether the field may be used for a resource category.
func (s ScopeFieldSpec) AppliesTo(category ResourceCategory) bool {
	for _, candidate := range s.Categories {
		if candidate == category {
			return true
		}
	}
	return false
}

// Supports reports whether the operator is valid for the field kind.
func (s ScopeFieldSpec) Supports(operator RuleOperator) bool {
	if operator == RuleOpAlways {
		return true
	}
	switch s.Kind {
	case ScopeFieldBoolean:
		return operator == RuleOpEq || operator == RuleOpIn
	case ScopeFieldOSFamily:
		return operator == RuleOpEq || operator == RuleOpIn
	default:
		switch operator {
		case RuleOpEq, RuleOpContains, RuleOpContainsAny, RuleOpIn, RuleOpRegexp:
			return true
		default:
			return false
		}
	}
}

// ValidateValue checks a user-supplied rule value against the field kind.
func (s ScopeFieldSpec) ValidateValue(value string) error {
	switch s.Kind {
	case ScopeFieldBoolean:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "true", "false":
			return nil
		default:
			return NewValidationErrorf("values",
				"field %q takes true or false, got %q", s.Key, value)
		}
	case ScopeFieldOSFamily:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "linux", "windows":
			return nil
		default:
			return NewValidationErrorf("values",
				"field %q takes linux or windows, got %q", s.Key, value)
		}
	default:
		return nil
	}
}

// scopeFieldSpecs is the closed whitelist of rule fields.
//
// Order is the UI order of the field picker. Column names refer to the aliases
// declared by the M01 resource reader join (resources AS r, host_resources AS h,
// …); virtual fields leave Column empty and are expanded by the reader.
var scopeFieldSpecs = []ScopeFieldSpec{
	{Key: "os_family", Label: "操作系统家族", Kind: ScopeFieldOSFamily, Categories: []ResourceCategory{CategoryHost}},
	{Key: "os_type", Label: "操作系统", Kind: ScopeFieldText, Column: "h.os_type", Categories: []ResourceCategory{CategoryHost}},
	{Key: "os_version", Label: "操作系统版本", Kind: ScopeFieldText, Column: "h.os_version", Categories: []ResourceCategory{CategoryHost}},
	{Key: "hostname", Label: "主机名", Kind: ScopeFieldText, Column: "h.hostname", Categories: []ResourceCategory{CategoryHost}},
	{Key: "has_npu", Label: "是否带 NPU", Kind: ScopeFieldBoolean, Column: "h.has_npu", Categories: []ResourceCategory{CategoryHost}},
	{Key: "has_gpu", Label: "是否带 GPU", Kind: ScopeFieldBoolean, Column: "h.has_gpu", Categories: []ResourceCategory{CategoryHost}},
	{Key: "database_type", Label: "数据库类型", Kind: ScopeFieldText, Column: "d.database_type", Categories: []ResourceCategory{CategoryDatabase}},
	{Key: "database_version", Label: "数据库版本", Kind: ScopeFieldText, Column: "d.version", Categories: []ResourceCategory{CategoryDatabase}},
	{Key: "middleware_type", Label: "中间件类型", Kind: ScopeFieldText, Column: "m.middleware_type", Categories: []ResourceCategory{CategoryMiddleware}},
	{Key: "middleware_version", Label: "中间件版本", Kind: ScopeFieldText, Column: "m.version", Categories: []ResourceCategory{CategoryMiddleware}},
	{Key: "service_name", Label: "服务名", Kind: ScopeFieldText, Column: "a.service_name", Categories: []ResourceCategory{CategoryApplication}},
	{Key: "protocol", Label: "协议", Kind: ScopeFieldText, Column: "a.protocol", Categories: []ResourceCategory{CategoryApplication}},
	{Key: "api_name", Label: "接口名", Kind: ScopeFieldText, Column: "i.api_name", Categories: []ResourceCategory{CategoryInterfaceService}},
	{Key: "target_name", Label: "目标名称", Kind: ScopeFieldText, Column: "g.target_name", Categories: []ResourceCategory{CategoryGenericTarget}},
	{Key: "exporter_type", Label: "端点类型", Kind: ScopeFieldText, Column: "g.exporter_type", Categories: []ResourceCategory{CategoryGenericTarget}},
}

// ScopeFieldSpecs returns the whitelist (copy) for schema/introspection APIs.
func ScopeFieldSpecs() []ScopeFieldSpec {
	out := make([]ScopeFieldSpec, len(scopeFieldSpecs))
	copy(out, scopeFieldSpecs)
	return out
}

// ScopeFieldSpecFor looks up one field by key.
func ScopeFieldSpecFor(key string) (ScopeFieldSpec, bool) {
	trimmed := strings.TrimSpace(key)
	for _, spec := range scopeFieldSpecs {
		if spec.Key == trimmed {
			return spec, true
		}
	}
	return ScopeFieldSpec{}, false
}

// AllowedScopeFieldKeys returns the whitelist keys, in UI order.
func AllowedScopeFieldKeys() []string {
	out := make([]string, 0, len(scopeFieldSpecs))
	for _, spec := range scopeFieldSpecs {
		out = append(out, spec.Key)
	}
	return out
}

// ScopeFieldSpecsForCategory returns the fields usable by one category.
func ScopeFieldSpecsForCategory(category ResourceCategory) []ScopeFieldSpec {
	out := make([]ScopeFieldSpec, 0, len(scopeFieldSpecs))
	for _, spec := range scopeFieldSpecs {
		if spec.AppliesTo(category) {
			out = append(out, spec)
		}
	}
	return out
}
