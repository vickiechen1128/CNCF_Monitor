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

// AttributeDefinition is one long-tail capability key (SRS Module_07 v2.1 §5.8
// FR-31). Registering a key is a data change: no schema change, no release.
type AttributeDefinition struct {
	ID               string
	Key              string
	DisplayName      string
	ValueType        AttributeValueType
	ResourceCategory Category
	EnumOptions      []string
	Required         bool
	Enabled          bool
	Description      string
	CreatedAt        time.Time
	UpdatedAt        time.Time
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
