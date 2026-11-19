package domain

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// AttributeValueType is the value type of an extension attribute.
type AttributeValueType string

// Supported extension attribute value types.
const (
	AttributeTypeBoolean AttributeValueType = "boolean"
	AttributeTypeNumber  AttributeValueType = "number"
	AttributeTypeText    AttributeValueType = "text"
	AttributeTypeEnum    AttributeValueType = "enum"
)

// Valid reports whether the value type is known.
func (t AttributeValueType) Valid() bool {
	switch t {
	case AttributeTypeBoolean, AttributeTypeNumber, AttributeTypeText, AttributeTypeEnum:
		return true
	default:
		return false
	}
}

var attributeKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{1,63}$`)

// AttributeStatus is the lifecycle state of a custom field
// (SRS Module_07 v2.2 §5.8 FR-34).
//
// active  = 在模型中：资源表单渲染、可填值；
// removed = 已移出：表单不渲染，历史值保留。
//
// There is deliberately no "disabled" state: a custom field is either part of
// the CI model or it has been removed from it.
type AttributeStatus string

// Custom field lifecycle states.
const (
	AttributeStatusActive  AttributeStatus = "active"
	AttributeStatusRemoved AttributeStatus = "removed"
)

// Valid reports whether the status is known.
func (s AttributeStatus) Valid() bool {
	return s == AttributeStatusActive || s == AttributeStatusRemoved
}

// AttributeGroup is the display group of a CI field
// (SRS Module_07 v2.2 §5.8 FR-33). Groups are a fixed enumeration: users pick
// one when registering a custom field, they never type a free-form group name.
type AttributeGroup string

// CI field display groups.
const (
	AttributeGroupIdentity   AttributeGroup = "identity"   // 身份信息
	AttributeGroupOwnership  AttributeGroup = "ownership"  // 归属信息
	AttributeGroupRuntime    AttributeGroup = "runtime"    // 运行信息
	AttributeGroupCollection AttributeGroup = "collection" // 采集信息
	AttributeGroupCapability AttributeGroup = "capability" // 能力信息
	AttributeGroupProfile    AttributeGroup = "profile"    // 画像信息
)

// ValidAttributeGroups returns the authoritative group list in display order.
func ValidAttributeGroups() []AttributeGroup {
	return []AttributeGroup{
		AttributeGroupIdentity,
		AttributeGroupOwnership,
		AttributeGroupRuntime,
		AttributeGroupCollection,
		AttributeGroupCapability,
		AttributeGroupProfile,
	}
}

// Valid reports whether the group is a known display group.
func (g AttributeGroup) Valid() bool {
	for _, group := range ValidAttributeGroups() {
		if g == group {
			return true
		}
	}
	return false
}

// AttributeGroupLabel returns the Chinese display name of a group.
func AttributeGroupLabel(g AttributeGroup) string {
	switch g {
	case AttributeGroupIdentity:
		return "身份信息"
	case AttributeGroupOwnership:
		return "归属信息"
	case AttributeGroupRuntime:
		return "运行信息"
	case AttributeGroupCollection:
		return "采集信息"
	case AttributeGroupCapability:
		return "能力信息"
	case AttributeGroupProfile:
		return "画像信息"
	default:
		return string(g)
	}
}

// AttributeDefinition is one custom CI field (SRS Module_07 v2.2 §5.8 FR-31).
// Registering a field is a data change: no schema change, no release.
type AttributeDefinition struct {
	ID               string
	Key              string
	DisplayName      string
	ValueType        AttributeValueType
	ResourceCategory Category
	EnumOptions      []string
	Required         bool
	// Enabled is deprecated (v2.2): reads must use Status. It is kept so the
	// physical column stays readable for historical rows.
	Enabled     bool
	Status      AttributeStatus
	Group       AttributeGroup
	Order       int
	Description string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Validate checks the definition shape.
func (d AttributeDefinition) Validate() error {
	if !attributeKeyPattern.MatchString(strings.TrimSpace(d.Key)) {
		return newValidationError("attribute_key",
			"must match %s (lowercase letters, digits and underscore)", attributeKeyPattern.String())
	}
	if strings.TrimSpace(d.DisplayName) == "" {
		return newValidationError("display_name", "is required")
	}
	if !d.ValueType.Valid() {
		return newValidationError("value_type", "must be boolean/number/text/enum")
	}
	if !d.ResourceCategory.Valid() {
		return newValidationError("resource_category", "must be a known category")
	}
	if d.Status != "" && !d.Status.Valid() {
		return newValidationError("status", "must be active/removed")
	}
	if !d.Group.Valid() {
		return newValidationError("display_group", "must be a known display group")
	}
	if d.Order < 0 {
		return newValidationError("display_order", "must not be negative")
	}
	if d.ValueType == AttributeTypeEnum && len(d.EnumOptions) == 0 {
		return newValidationError("enum_options", "is required for enum attributes")
	}
	for _, option := range d.EnumOptions {
		if strings.TrimSpace(option) == "" {
			return newValidationError("enum_options", "must not contain empty values")
		}
	}
	return nil
}

// EffectiveStatus returns Status, falling back to the deprecated Enabled flag
// for rows written before v2.2.
func (d AttributeDefinition) EffectiveStatus() AttributeStatus {
	if d.Status == AttributeStatusRemoved {
		return AttributeStatusRemoved
	}
	if d.Status == AttributeStatusActive {
		return AttributeStatusActive
	}
	if !d.Enabled {
		return AttributeStatusRemoved
	}
	return AttributeStatusActive
}

// ValidateValue checks and normalizes a user-supplied value against the type.
func (d AttributeDefinition) ValidateValue(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		if d.Required {
			return "", newValidationError("attributes", "attribute %q is required", d.Key)
		}
		return "", nil
	}
	switch d.ValueType {
	case AttributeTypeBoolean:
		lower := strings.ToLower(value)
		if lower != "true" && lower != "false" {
			return "", newValidationError("attributes",
				"attribute %q takes true or false, got %q", d.Key, value)
		}
		return lower, nil
	case AttributeTypeNumber:
		if _, err := strconv.ParseFloat(value, 64); err != nil {
			return "", newValidationError("attributes",
				"attribute %q must be numeric, got %q", d.Key, value)
		}
		return value, nil
	case AttributeTypeEnum:
		for _, option := range d.EnumOptions {
			if option == value {
				return value, nil
			}
		}
		return "", newValidationError("attributes",
			"attribute %q must be one of %s, got %q", d.Key, strings.Join(d.EnumOptions, " / "), value)
	default:
		if len(value) > 500 {
			return "", newValidationError("attributes",
				"attribute %q must be at most 500 characters", d.Key)
		}
		return value, nil
	}
}

// ResourceAttribute is one capability value attached to a resource.
type ResourceAttribute struct {
	ID         string
	ResourceID string
	Key        string
	Value      string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// Validate normalizes the key.
func (a *ResourceAttribute) Validate() error {
	a.Key = strings.TrimSpace(a.Key)
	if a.ResourceID == "" {
		return newValidationError("resource_id", "is required")
	}
	if a.Key == "" {
		return newValidationError("attribute_key", "is required")
	}
	return nil
}

// String renders the attribute for error messages and logs.
func (a ResourceAttribute) String() string {
	return fmt.Sprintf("%s=%s", a.Key, a.Value)
}
