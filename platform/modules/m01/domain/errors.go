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

// Error implements the error interface.
func (e *ValidationError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return fmt.Sprintf("%s: %s", e.Field, e.Message)
}

// ErrorKind implements apierror.Coded.
func (e *ValidationError) ErrorKind() apierror.Kind { return apierror.BadRequest }

// NewValidationError builds a field validation error with a fixed message.
func NewValidationError(field, message string) *ValidationError {
	return &ValidationError{Field: field, Message: message}
}

// NewValidationErrorf builds a field validation error with a formatted message.
func NewValidationErrorf(field, format string, args ...any) *ValidationError {
	return &ValidationError{Field: field, Message: fmt.Sprintf(format, args...)}
}

// NotFoundError indicates an entity does not exist (or was soft-deleted).
type NotFoundError struct {
	Entity string
	ID     string
}

// Error implements the error interface.
func (e *NotFoundError) Error() string {
	return fmt.Sprintf("%s %q not found", e.Entity, e.ID)
}

// ErrorKind implements apierror.Coded.
func (e *NotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// ConflictError indicates a uniqueness / reference conflict.
type ConflictError struct {
	Entity  string
	Field   string
	Value   string
	Message string
}

// Error implements the error interface.
func (e *ConflictError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	if e.Field == "" {
		return fmt.Sprintf("%s conflict: %s", e.Entity, e.Value)
	}
	return fmt.Sprintf("%s conflict: %s %q already exists", e.Entity, e.Field, e.Value)
}

// ErrorKind implements apierror.Coded.
func (e *ConflictError) ErrorKind() apierror.Kind { return apierror.Conflict }

// ForbiddenError indicates a write against a protected (built-in) row.
type ForbiddenError struct {
	Message string
}

// Error implements the error interface.
func (e *ForbiddenError) Error() string { return e.Message }

// ErrorKind implements apierror.Coded.
func (e *ForbiddenError) ErrorKind() apierror.Kind { return apierror.Forbidden }
