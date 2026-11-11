package domain

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// ValidationError describes a field-level validation failure.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ErrorKind implements apierror.Coded.
func (e *ValidationError) ErrorKind() apierror.Kind { return apierror.BadRequest }

func newValidationError(field, format string, args ...any) *ValidationError {
	return &ValidationError{Field: field, Message: fmt.Sprintf(format, args...)}
}

// NotFoundError indicates a resource does not exist (or was soft-deleted).
type NotFoundError struct {
	ResourceID string
}

func (e *NotFoundError) Error() string {
	return fmt.Sprintf("resource %q not found", e.ResourceID)
}

// ErrorKind implements apierror.Coded.
func (e *NotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// ConflictError indicates a duplicate dedup key.
type ConflictError struct {
	ResourceID string
	DedupKey   string
}

func (e *ConflictError) Error() string {
	if e.ResourceID != "" {
		return fmt.Sprintf("resource conflict: dedup_key %q already used by %s", e.DedupKey, e.ResourceID)
	}
	return fmt.Sprintf("resource conflict: dedup_key %q already exists", e.DedupKey)
}

// ErrorKind implements apierror.Coded.
func (e *ConflictError) ErrorKind() apierror.Kind { return apierror.Conflict }

// UnsupportedCategoryError indicates a category without a domain implementation.
type UnsupportedCategoryError struct {
	Category string
}

func (e *UnsupportedCategoryError) Error() string {
	return fmt.Sprintf("unsupported resource_category %q", e.Category)
}

// ErrorKind implements apierror.Coded.
func (e *UnsupportedCategoryError) ErrorKind() apierror.Kind { return apierror.BadRequest }
