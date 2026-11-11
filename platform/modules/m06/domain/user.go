package domain

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// UserStatus is the lifecycle state of a platform account.
type UserStatus string

// User status constants (aligned with models.UserStatus).
const (
	UserStatusActive   UserStatus = "active"
	UserStatusDisabled UserStatus = "disabled"
)

// UserRole is the two-level administrative role (D44).
type UserRole string

// User role constants (aligned with models.UserRole*).
const (
	UserRoleAdmin UserRole = "admin"
	UserRoleUser  UserRole = "user"
)

// User is the M06 administrative view of a platform account. PasswordHash is
// deliberately absent: only the repository touches the hash column.
type User struct {
	ID          string
	TenantID    string
	Username    string
	DisplayName string
	Role        UserRole
	Status      UserStatus
	LastLoginAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreateUserInput carries the validated creation fields. tenant_id and status
// are server-owned: MVP fixes them to platform_admin / active.
type CreateUserInput struct {
	Username    string
	DisplayName string
	Password    string
	Role        string
}

// UpdateUserInput carries the mutable profile fields. Nil means "not present";
// username is immutable and rejected by the strict JSON decoder.
type UpdateUserInput struct {
	DisplayName *string
	Role        *string
}

// HasChanges reports whether at least one mutable field was supplied.
func (i UpdateUserInput) HasChanges() bool {
	return i.DisplayName != nil || i.Role != nil
}

// ParseUserStatus parses an optional status filter.
func ParseUserStatus(raw string) (UserStatus, error) {
	value := UserStatus(strings.TrimSpace(raw))
	if value == "" {
		return "", nil
	}
	if value != UserStatusActive && value != UserStatusDisabled {
		return "", &ValidationError{Field: "status", Message: fmt.Sprintf("invalid status %q: must be active or disabled", raw)}
	}
	return value, nil
}

// ParseUserRole parses an optional role filter. Empty is allowed.
func ParseUserRole(raw string) (UserRole, error) {
	value := UserRole(strings.TrimSpace(raw))
	if value == "" {
		return "", nil
	}
	if value != UserRoleAdmin && value != UserRoleUser {
		return "", &ValidationError{Field: "role", Message: fmt.Sprintf("invalid role %q: must be admin or user", raw)}
	}
	return value, nil
}

// UserNotFoundError marks a missing account (HTTP 404).
type UserNotFoundError struct {
	UserID string
}

func (e *UserNotFoundError) Error() string {
	return fmt.Sprintf("user %q not found", e.UserID)
}

// ErrorKind returns the contract kind.
func (e *UserNotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// UsernameTakenError marks a duplicate username (HTTP 409).
type UsernameTakenError struct {
	Username string
}

func (e *UsernameTakenError) Error() string {
	return fmt.Sprintf("username %q already exists", e.Username)
}

// ErrorKind returns the contract kind.
func (e *UsernameTakenError) ErrorKind() apierror.Kind { return apierror.Conflict }

// LastAdminError marks an operation that would leave no active administrator
// (HTTP 409).
type LastAdminError struct {
	Operation string
}

func (e *LastAdminError) Error() string {
	operation := e.Operation
	if operation == "" {
		operation = "this operation"
	}
	return fmt.Sprintf("%s would leave no active platform administrator; create or enable another admin first", operation)
}

// ErrorKind returns the contract kind.
func (e *LastAdminError) ErrorKind() apierror.Kind { return apierror.Conflict }

// NewUserID returns a random UUID-v4-shaped account id.
func NewUserID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate user id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(b)
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32]), nil
}
