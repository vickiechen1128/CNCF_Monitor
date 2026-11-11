// Package domain contains the M06 v3 administrative domain model.
package domain

import (
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// TenantStatus is the lifecycle status of a tenant.
type TenantStatus string

// Tenant status constants (aligned with models.TenantStatus).
const (
	TenantStatusActive    TenantStatus = "active"
	TenantStatusSuspended TenantStatus = "suspended"
	TenantStatusDisabled  TenantStatus = "disabled"
)

// Valid reports whether the status is one of the accepted values.
func (s TenantStatus) Valid() bool {
	switch s {
	case TenantStatusActive, TenantStatusSuspended, TenantStatusDisabled:
		return true
	default:
		return false
	}
}

// ParseTenantStatus parses an optional status filter. Empty is allowed.
func ParseTenantStatus(raw string) (TenantStatus, error) {
	value := TenantStatus(strings.TrimSpace(raw))
	if value == "" {
		return "", nil
	}
	if !value.Valid() {
		return "", &ValidationError{Field: "status", Message: fmt.Sprintf("invalid status %q", raw)}
	}
	return value, nil
}

// Tenant is the M06 administrative view of a tenant.
type Tenant struct {
	ID               string
	Name             string
	NetworkDomainIDs []string
	MultiSiteEnabled bool
	IsPlatformAdmin  bool
	Status           TenantStatus
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// UpdateTenantInput carries the mutable tenant fields. Nil means "not present"
// so PUT can reject requests that only carry immutable fields.
type UpdateTenantInput struct {
	Name             *string
	MultiSiteEnabled *bool
}

// HasChanges reports whether the request carries at least one mutable field.
func (i UpdateTenantInput) HasChanges() bool {
	return i.Name != nil || i.MultiSiteEnabled != nil
}

// ValidationError marks a client-side input violation (HTTP 400).
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

// ErrorKind returns the contract kind.
func (e *ValidationError) ErrorKind() apierror.Kind { return apierror.BadRequest }

// TenantNotFoundError marks a missing tenant (HTTP 404).
type TenantNotFoundError struct {
	TenantID string
}

func (e *TenantNotFoundError) Error() string {
	return fmt.Sprintf("tenant %q not found", e.TenantID)
}

// ErrorKind returns the contract kind.
func (e *TenantNotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// ForbiddenError marks an operation that is not available in this release.
type ForbiddenError struct {
	Message string
}

func (e *ForbiddenError) Error() string { return e.Message }

// ErrorKind returns the contract kind.
func (e *ForbiddenError) ErrorKind() apierror.Kind { return apierror.Forbidden }

// ConflictError marks a uniqueness / coexistence violation (HTTP 409).
type ConflictError struct {
	Message string
}

func (e *ConflictError) Error() string { return e.Message }

// ErrorKind returns the contract kind.
func (e *ConflictError) ErrorKind() apierror.Kind { return apierror.Conflict }
