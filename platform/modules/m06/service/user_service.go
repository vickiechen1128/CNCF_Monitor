package service

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"golang.org/x/crypto/bcrypt"
)

const (
	minPasswordLength = 8
	maxPasswordBytes  = 72 // bcrypt input limit
	maxUsernameLength = 64
	maxDisplayNameLen = 100
)

// UserService implements platform account administration.
type UserService struct {
	users repository.UserRepository
	// guard serializes admin-affecting mutations so the last-admin check and
	// the write cannot interleave inside one process. Multi-instance
	// deployments need a database-level lock (documented as a v2.0 debt).
	guard sync.Mutex
}

// NewUserService constructs a user service.
func NewUserService(users repository.UserRepository) *UserService {
	return &UserService{users: users}
}

// List returns users matching the filters.
func (s *UserService) List(ctx context.Context, filter repository.ListUsersFilter) ([]*domain.User, int64, error) {
	return s.users.List(ctx, filter)
}

// Get returns one user.
func (s *UserService) Get(ctx context.Context, id string) (*domain.User, error) {
	if strings.TrimSpace(id) == "" {
		return nil, &domain.ValidationError{Field: "id", Message: "is required"}
	}
	return s.users.Get(ctx, id)
}

// Create registers a new active account under platform_admin.
func (s *UserService) Create(ctx context.Context, input domain.CreateUserInput) (*domain.User, error) {
	username := strings.TrimSpace(input.Username)
	if username == "" {
		return nil, &domain.ValidationError{Field: "username", Message: "is required"}
	}
	if len(username) > maxUsernameLength {
		return nil, &domain.ValidationError{Field: "username", Message: fmt.Sprintf("must be at most %d characters", maxUsernameLength)}
	}
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		return nil, &domain.ValidationError{Field: "display_name", Message: "is required"}
	}
	if len([]rune(displayName)) > maxDisplayNameLen {
		return nil, &domain.ValidationError{Field: "display_name", Message: fmt.Sprintf("must be at most %d characters", maxDisplayNameLen)}
	}
	if err := validatePassword(input.Password); err != nil {
		return nil, err
	}
	role, err := normalizeRole(input.Role)
	if err != nil {
		return nil, err
	}

	id, err := domain.NewUserID()
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}
	user := &domain.User{
		ID:          id,
		TenantID:    models.PlatformAdminTenantID,
		Username:    username,
		DisplayName: displayName,
		Role:        role,
		Status:      domain.UserStatusActive,
	}
	if err := s.users.Create(ctx, user, string(hash)); err != nil {
		return nil, err
	}
	return user, nil
}

// Update applies the mutable profile fields. Demoting the last active admin is
// rejected so the platform always keeps an administrative entry point.
func (s *UserService) Update(ctx context.Context, id string, input domain.UpdateUserInput) (*domain.User, error) {
	if !input.HasChanges() {
		return nil, &domain.ValidationError{
			Field:   "body",
			Message: "at least one of display_name/role is required",
		}
	}
	s.guard.Lock()
	defer s.guard.Unlock()
	current, err := s.users.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if input.DisplayName != nil {
		displayName := strings.TrimSpace(*input.DisplayName)
		if displayName == "" {
			return nil, &domain.ValidationError{Field: "display_name", Message: "must not be empty"}
		}
		if len([]rune(displayName)) > maxDisplayNameLen {
			return nil, &domain.ValidationError{Field: "display_name", Message: fmt.Sprintf("must be at most %d characters", maxDisplayNameLen)}
		}
		input.DisplayName = &displayName
	}
	if input.Role != nil {
		role, err := domain.ParseUserRole(*input.Role)
		if err != nil {
			return nil, err
		}
		if role == "" {
			return nil, &domain.ValidationError{Field: "role", Message: "must be admin or user"}
		}
		if current.Role == domain.UserRoleAdmin && current.Status == domain.UserStatusActive && role != domain.UserRoleAdmin {
			others, err := s.users.CountActiveAdmins(ctx, id)
			if err != nil {
				return nil, err
			}
			if others == 0 {
				return nil, &domain.LastAdminError{Operation: "demoting the last active administrator"}
			}
		}
		roleValue := string(role)
		input.Role = &roleValue
	}
	return s.users.UpdateProfile(ctx, id, input)
}

// UpdateStatus enables or disables an account. Disabling revokes sessions in
// the repository and is rejected when it would remove the last active admin.
func (s *UserService) UpdateStatus(ctx context.Context, id, rawStatus string) (*domain.User, error) {
	status, err := domain.ParseUserStatus(rawStatus)
	if err != nil {
		return nil, err
	}
	if status == "" {
		return nil, &domain.ValidationError{Field: "status", Message: "is required"}
	}
	s.guard.Lock()
	defer s.guard.Unlock()
	current, err := s.users.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if status == domain.UserStatusDisabled &&
		current.Role == domain.UserRoleAdmin &&
		current.Status == domain.UserStatusActive {
		others, err := s.users.CountActiveAdmins(ctx, id)
		if err != nil {
			return nil, err
		}
		if others == 0 {
			return nil, &domain.LastAdminError{Operation: "disabling the last active administrator"}
		}
	}
	return s.users.UpdateStatus(ctx, id, status)
}

// ResetPassword replaces the password hash and revokes all sessions.
func (s *UserService) ResetPassword(ctx context.Context, id, newPassword string) error {
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	if _, err := s.users.Get(ctx, id); err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	return s.users.UpdatePassword(ctx, id, string(hash))
}

// Delete soft-deletes a normal user and revokes sessions. Administrator
// accounts cannot be deleted; disable them instead (SRS FR-03). Deleting the
// last active admin is reported as a conflict so the guard is explicit.
func (s *UserService) Delete(ctx context.Context, id string) error {
	s.guard.Lock()
	defer s.guard.Unlock()
	current, err := s.users.Get(ctx, id)
	if err != nil {
		return err
	}
	if current.Role == domain.UserRoleAdmin {
		if current.Status == domain.UserStatusActive {
			others, err := s.users.CountActiveAdmins(ctx, id)
			if err != nil {
				return err
			}
			if others == 0 {
				return &domain.LastAdminError{Operation: "deleting the last active administrator"}
			}
		}
		return &domain.ValidationError{
			Field:   "role",
			Message: "admin accounts cannot be deleted; disable them instead",
		}
	}
	return s.users.Delete(ctx, id)
}

func normalizeRole(raw string) (domain.UserRole, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return domain.UserRoleUser, nil
	}
	role, err := domain.ParseUserRole(value)
	if err != nil {
		return "", err
	}
	return role, nil
}

func validatePassword(password string) error {
	if len(password) < minPasswordLength {
		return &domain.ValidationError{Field: "password", Message: fmt.Sprintf("must be at least %d characters", minPasswordLength)}
	}
	if len(password) > maxPasswordBytes {
		return &domain.ValidationError{Field: "password", Message: fmt.Sprintf("must be at most %d bytes (bcrypt limit)", maxPasswordBytes)}
	}
	return nil
}
