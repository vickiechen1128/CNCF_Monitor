package domain

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// LabelSourceType defines where a label mapping's source field comes from.
type LabelSourceType string

// Label source types (Module_07 §5.11).
const (
	LabelMappingSourceResourceField     LabelSourceType = "resource_field"
	LabelMappingSourceComposite         LabelSourceType = "composite"
	LabelMappingSourcePrometheusBuiltin LabelSourceType = "prometheus_builtin"
	LabelMappingSourceCMDB              LabelSourceType = "cmdb_field"
)

// Valid reports whether the source type is supported in v3.
func (t LabelSourceType) Valid() bool {
	switch t {
	case LabelMappingSourceResourceField, LabelMappingSourceComposite,
		LabelMappingSourcePrometheusBuiltin, LabelMappingSourceCMDB:
		return true
	default:
		return false
	}
}

// LabelMapping maps one source field to a Prometheus target label.
type LabelMapping struct {
	SourceField string          `json:"source_field"`
	SourceType  LabelSourceType `json:"source_type"`
	TargetLabel string          `json:"target_label"`
	Enabled     bool            `json:"enabled"`
	Transform   string          `json:"transform,omitempty"`
}

// LabelTemplate is a category-anchored set of label mappings.
type LabelTemplate struct {
	ID               string
	Name             string
	ResourceCategory Category
	IsDefault        bool
	Mappings         []LabelMapping
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

var targetLabelPattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// Normalize trims user input and turns a nil mapping list into an empty one.
func (t *LabelTemplate) Normalize() {
	t.Name = strings.TrimSpace(t.Name)
	if t.Mappings == nil {
		t.Mappings = []LabelMapping{}
	}
	for i := range t.Mappings {
		t.Mappings[i].SourceField = strings.TrimSpace(t.Mappings[i].SourceField)
		t.Mappings[i].TargetLabel = strings.TrimSpace(t.Mappings[i].TargetLabel)
		t.Mappings[i].Transform = strings.TrimSpace(t.Mappings[i].Transform)
	}
}

// Validate checks a normalized template.
func (t *LabelTemplate) Validate() error {
	if t.Name == "" {
		return &ValidationError{Field: "name", Message: "is required"}
	}
	if len(t.Name) > 100 {
		return &ValidationError{Field: "name", Message: "must be at most 100 characters"}
	}
	if !t.ResourceCategory.Valid() {
		return &ValidationError{Field: "resource_category", Message: "must be a known category"}
	}
	seen := make(map[string]struct{}, len(t.Mappings))
	for i, mapping := range t.Mappings {
		prefix := fmt.Sprintf("mappings[%d]", i)
		if mapping.TargetLabel == "" {
			return &ValidationError{Field: prefix + ".target_label", Message: "is required"}
		}
		if strings.HasPrefix(mapping.TargetLabel, "__") {
			return &ValidationError{Field: prefix + ".target_label", Message: "must not start with __"}
		}
		if !targetLabelPattern.MatchString(mapping.TargetLabel) {
			return &ValidationError{Field: prefix + ".target_label", Message: "must match [a-zA-Z_][a-zA-Z0-9_]*"}
		}
		if mapping.SourceField == "" {
			return &ValidationError{Field: prefix + ".source_field", Message: "is required"}
		}
		if !mapping.SourceType.Valid() {
			return &ValidationError{Field: prefix + ".source_type", Message: "must be resource_field, composite, prometheus_builtin or cmdb_field"}
		}
		if mapping.SourceType == LabelMappingSourceComposite && mapping.TargetLabel != "instance" {
			return &ValidationError{Field: prefix + ".target_label", Message: "composite sources must map to instance"}
		}
		switch mapping.Transform {
		case "", "lower", "upper", "prefix", "replace":
		default:
			return &ValidationError{Field: prefix + ".transform", Message: "must be lower, upper, prefix, replace or empty"}
		}
		if _, duplicate := seen[mapping.TargetLabel]; duplicate {
			return &ValidationError{Field: prefix + ".target_label", Message: fmt.Sprintf("duplicate target label %q", mapping.TargetLabel)}
		}
		seen[mapping.TargetLabel] = struct{}{}
	}
	return nil
}

// LabelTemplateNotFoundError indicates a missing (or soft-deleted) template.
type LabelTemplateNotFoundError struct {
	ID string
}

// Error implements the error interface.
func (e *LabelTemplateNotFoundError) Error() string {
	return fmt.Sprintf("label_template %q not found", e.ID)
}

// ErrorKind implements apierror.Coded.
func (e *LabelTemplateNotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// LabelTemplateConflictError indicates a name/default conflict or a referenced
// template that cannot be deleted.
type LabelTemplateConflictError struct {
	Message string
}

// Error implements the error interface.
func (e *LabelTemplateConflictError) Error() string { return e.Message }

// ErrorKind implements apierror.Coded.
func (e *LabelTemplateConflictError) ErrorKind() apierror.Kind { return apierror.Conflict }
