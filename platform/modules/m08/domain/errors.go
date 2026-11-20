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

// ValidationIssue is one line-level problem reported by the config validator.
type ValidationIssue struct {
	Line    int    `json:"line"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// ValidationCause explains who can fix a failed validation.
type ValidationCause string

// Validation causes (contract §1.1).
const (
	ValidationCauseUserConfig    ValidationCause = "user_config"
	ValidationCausePlatformFault ValidationCause = "platform_fault"
	ValidationCauseNone          ValidationCause = "none"
)

// ConfigValidationError carries line-level issues for a rejected configuration
// (FR-04). The HTTP layer renders it with the `data.validation` extension.
type ConfigValidationError struct {
	Cause ValidationCause
	Note  string
	Items []ValidationIssue
}

// Error implements the error interface.
func (e *ConfigValidationError) Error() string {
	if len(e.Items) == 0 {
		return "alertmanager configuration validation failed"
	}
	first := e.Items[0]
	if first.Line > 0 {
		return fmt.Sprintf("line %d: %s", first.Line, first.Message)
	}
	return first.Message
}

// ErrorKind implements apierror.Coded.
func (e *ConfigValidationError) ErrorKind() apierror.Kind { return apierror.BadRequest }

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
	Message string
}

// Error implements the error interface.
func (e *ConflictError) Error() string { return e.Message }

// ErrorKind implements apierror.Coded.
func (e *ConflictError) ErrorKind() apierror.Kind { return apierror.Conflict }

// ForbiddenError indicates a write against a protected (built-in) row or an
// out-of-scope resource.
type ForbiddenError struct {
	Message string
}

// Error implements the error interface.
func (e *ForbiddenError) Error() string { return e.Message }

// ErrorKind implements apierror.Coded.
func (e *ForbiddenError) ErrorKind() apierror.Kind { return apierror.Forbidden }

// UnavailableError indicates a dependency is not ready (HTTP 503, retryable):
// amtool missing (D48) or the reload target not configured (D46).
type UnavailableError struct {
	Message string
}

// Error implements the error interface.
func (e *UnavailableError) Error() string { return e.Message }

// ErrorKind implements apierror.Coded.
func (e *UnavailableError) ErrorKind() apierror.Kind { return apierror.Unavailable }

// UpstreamError indicates Alertmanager is unreachable (HTTP 502).
type UpstreamError struct {
	Message string
	Err     error
}

// Error implements the error interface.
func (e *UpstreamError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

// Unwrap exposes the cause for logs.
func (e *UpstreamError) Unwrap() error { return e.Err }

// ErrorKind implements apierror.Coded.
func (e *UpstreamError) ErrorKind() apierror.Kind { return apierror.Internal }
