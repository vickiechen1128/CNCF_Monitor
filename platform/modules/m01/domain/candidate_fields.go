package domain

import "strings"

// Field dictionary of a scrape job selector (SRS Module_01 v1.5 §5.6).
//
// The dictionary is the server-owned whitelist behind FR-22 / NFR-11: callers
// send a field KEY, never a physical column, and the query builder owns the
// mapping. Built-in fields come from M07's CI model; custom fields (registered
// through M07's CI model page) are matched by key against m07_resource_attributes
// and do not appear in this static list.

// FieldKind classifies a selector field.
type FieldKind string

// Supported selector field kinds.
const (
	// FieldKindText is a free-text attribute matched by string operators.
	FieldKindText FieldKind = "text"
	// FieldKindBoolean is a boolean capability flag.
	FieldKindBoolean FieldKind = "boolean"
	// FieldKindOSFamily is a virtual field that expands to OS dictionary
	// keywords, so ``os_family = linux`` keeps matching canonical OS names such
	// as "Ubuntu" or "RedHat Enterprise Linux".
	FieldKindOSFamily FieldKind = "os_family"
	// FieldKindEnum is a closed enumeration matched by equality only.
	FieldKindEnum FieldKind = "enum"
)

// FieldSpec describes one field a selector may reference.
type FieldSpec struct {
	Key        string
	Label      string
	Kind       FieldKind
	Column     string
	Categories []ResourceCategory
}

// AppliesTo reports whether the field may be used for a resource category.
func (s FieldSpec) AppliesTo(category ResourceCategory) bool {
	for _, candidate := range s.Categories {
		if candidate == category {
			return true
		}
	}
	return false
}

// Supports reports whether the operator is valid for the field kind.
func (s FieldSpec) Supports(operator RuleOperator) bool {
	if operator == RuleOpAlways {
		return true
	}
	switch s.Kind {
	case FieldKindBoolean, FieldKindOSFamily, FieldKindEnum:
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

// ValidateValue checks a user-supplied value against the field kind.
func (s FieldSpec) ValidateValue(value string) error {
	switch s.Kind {
	case FieldKindBoolean:
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "true", "false":
			return nil
		default:
			return NewValidationErrorf("values",
				"field %q takes true or false, got %q", s.Key, value)
		}
	case FieldKindOSFamily:
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

// allCategories is the shorthand for fields usable by every CI category.
var allCategories = []ResourceCategory{
	CategoryHost, CategoryDatabase, CategoryMiddleware,
	CategoryApplication, CategoryInterfaceService, CategoryGenericTarget,
}

// fieldSpecs is the closed whitelist of built-in selector fields.
//
// Order is the UI order of the field picker. Columns refer to the aliases
// declared by the M01 resource reader join (resources AS r, host_resources AS h,
// …); virtual fields leave Column empty and are expanded by the reader.
var fieldSpecs = []FieldSpec{
	// Ownership / lifecycle (all categories)
	{Key: "network_domain_id", Label: "网域", Kind: FieldKindEnum, Column: "r.network_domain_id", Categories: allCategories},
	{Key: "tenant_id", Label: "租户", Kind: FieldKindEnum, Column: "r.tenant_id", Categories: allCategories},
	{Key: "resource_category", Label: "资源类别", Kind: FieldKindEnum, Column: "r.resource_category", Categories: allCategories},
	{Key: "status", Label: "运行状态", Kind: FieldKindEnum, Column: "r.status", Categories: allCategories},
	{Key: "env", Label: "环境", Kind: FieldKindEnum, Column: "r.env", Categories: allCategories},
	{Key: "app_code", Label: "应用", Kind: FieldKindText, Column: "r.app_code", Categories: allCategories},
	{Key: "biz_code", Label: "业务", Kind: FieldKindText, Column: "r.biz_code", Categories: allCategories},
	{Key: "platform_code", Label: "平台", Kind: FieldKindText, Column: "r.platform_code", Categories: allCategories},
	{Key: "cluster", Label: "集群", Kind: FieldKindText, Column: "r.cluster", Categories: allCategories},
	{Key: "owner", Label: "负责人", Kind: FieldKindText, Column: "r.owner", Categories: allCategories},

	// Host
	{Key: "os_family", Label: "操作系统家族", Kind: FieldKindOSFamily, Categories: []ResourceCategory{CategoryHost}},
	{Key: "os_type", Label: "操作系统", Kind: FieldKindText, Column: "h.os_type", Categories: []ResourceCategory{CategoryHost}},
	{Key: "os_version", Label: "操作系统版本", Kind: FieldKindText, Column: "h.os_version", Categories: []ResourceCategory{CategoryHost}},
	{Key: "hostname", Label: "主机名", Kind: FieldKindText, Column: "h.hostname", Categories: []ResourceCategory{CategoryHost}},
	{Key: "has_npu", Label: "是否带 NPU", Kind: FieldKindBoolean, Column: "h.has_npu", Categories: []ResourceCategory{CategoryHost}},
	{Key: "has_gpu", Label: "是否带 GPU", Kind: FieldKindBoolean, Column: "h.has_gpu", Categories: []ResourceCategory{CategoryHost}},

	// Database
	{Key: "database_type", Label: "数据库类型", Kind: FieldKindText, Column: "d.database_type", Categories: []ResourceCategory{CategoryDatabase}},
	{Key: "database_version", Label: "数据库版本", Kind: FieldKindText, Column: "d.version", Categories: []ResourceCategory{CategoryDatabase}},

	// Middleware
	{Key: "middleware_type", Label: "中间件类型", Kind: FieldKindText, Column: "m.middleware_type", Categories: []ResourceCategory{CategoryMiddleware}},
	{Key: "middleware_version", Label: "中间件版本", Kind: FieldKindText, Column: "m.version", Categories: []ResourceCategory{CategoryMiddleware}},

	// Application
	{Key: "service_name", Label: "服务名", Kind: FieldKindText, Column: "a.service_name", Categories: []ResourceCategory{CategoryApplication}},
	{Key: "protocol", Label: "协议", Kind: FieldKindText, Column: "a.protocol", Categories: []ResourceCategory{CategoryApplication}},

	// Interface service
	{Key: "api_name", Label: "接口名", Kind: FieldKindText, Column: "i.api_name", Categories: []ResourceCategory{CategoryInterfaceService}},

	// Generic target
	{Key: "target_name", Label: "目标名称", Kind: FieldKindText, Column: "g.target_name", Categories: []ResourceCategory{CategoryGenericTarget}},
	{Key: "exporter_type", Label: "端点类型", Kind: FieldKindText, Column: "g.exporter_type", Categories: []ResourceCategory{CategoryGenericTarget}},
}

// FieldSpecs returns the built-in whitelist (copy) for schema/introspection APIs.
func FieldSpecs() []FieldSpec {
	out := make([]FieldSpec, len(fieldSpecs))
	copy(out, fieldSpecs)
	return out
}

// FieldSpecFor looks up one built-in field by key.
func FieldSpecFor(key string) (FieldSpec, bool) {
	trimmed := strings.TrimSpace(key)
	for _, spec := range fieldSpecs {
		if spec.Key == trimmed {
			return spec, true
		}
	}
	return FieldSpec{}, false
}

// AllowedFieldKeys returns the built-in whitelist keys, in UI order.
func AllowedFieldKeys() []string {
	out := make([]string, 0, len(fieldSpecs))
	for _, spec := range fieldSpecs {
		out = append(out, spec.Key)
	}
	return out
}
