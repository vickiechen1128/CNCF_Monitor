package domain

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// LabelSource is the label origin.
type LabelSource string

// Label sources.
const (
	LabelSourceSystem LabelSource = "system"
	LabelSourceUser   LabelSource = "user"
	LabelSourceCMDB   LabelSource = "cmdb"
)

// Label is a user/cmdb label attached to a resource. System labels are
// computed at generation time and are not persisted.
type Label struct {
	ID         string
	ResourceID string
	Key        string
	Value      string
	Source     LabelSource
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

var labelKeyPattern = regexp.MustCompile(`^[a-z0-9_]{1,128}$`)

// ValidateLabelKey validates the label key rules.
func ValidateLabelKey(key string) error {
	key = strings.TrimSpace(key)
	if key == "" {
		return newValidationError("key", "is required")
	}
	if strings.HasPrefix(key, "__") {
		return newValidationError("key", "must not start with __")
	}
	if !labelKeyPattern.MatchString(key) {
		return newValidationError("key", "must match ^[a-z0-9_]{1,128}$")
	}
	switch key {
	case "instance", "job", "scheme":
		return newValidationError("key", "%q is a Prometheus built-in label", key)
	}
	return nil
}

// ValidateLabelValue validates a label value.
func ValidateLabelValue(value string) error {
	if strings.TrimSpace(value) == "" {
		return newValidationError("value", "is required")
	}
	if len(value) > 1000 {
		return newValidationError("value", "must be at most 1000 characters")
	}
	return nil
}

// ValidateLabel checks key/value/source.
func (l *Label) Validate() error {
	if strings.TrimSpace(l.ResourceID) == "" {
		return newValidationError("resource_id", "is required")
	}
	if err := ValidateLabelKey(l.Key); err != nil {
		return err
	}
	if err := ValidateLabelValue(l.Value); err != nil {
		return err
	}
	switch l.Source {
	case LabelSourceUser, LabelSourceCMDB, LabelSourceSystem:
		return nil
	default:
		return newValidationError("source", "must be system/user/cmdb")
	}
}

// IsWritableCategory reports whether user labels may be written for category.
func IsWritableCategory(category Category) bool {
	return category == CategoryApplication || category == CategoryInterfaceService
}

// ForbiddenError indicates a policy rejection.
type ForbiddenError struct {
	Message string
}

func (e *ForbiddenError) Error() string { return fmt.Sprintf("forbidden: %s", e.Message) }
