package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"gorm.io/gorm"
)

// ListUsersFilter carries user list filters.
type ListUsersFilter struct {
	Keyword  string
	Role     string
	Status   string
	Page     int
	PageSize int
}

// UserRepository persists platform accounts and invalidates their sessions.
type UserRepository interface {
	List(ctx context.Context, filter ListUsersFilter) ([]*domain.User, int64, error)
	Get(ctx context.Context, id string) (*domain.User, error)
	Create(ctx context.Context, user *domain.User, passwordHash string) error
	UpdateProfile(ctx context.Context, id string, input domain.UpdateUserInput) (*domain.User, error)
	UpdateStatus(ctx context.Context, id string, status domain.UserStatus) (*domain.User, error)
	UpdatePassword(ctx context.Context, id, passwordHash string) error
	Delete(ctx context.Context, id string) error
	CountActiveAdmins(ctx context.Context, excludeUserID string) (int64, error)
}

// GORMUserRepository is the GORM-backed user repository. Mutations that revoke
// access (disable / password reset / delete) remove the user's sessions in the
// same transaction so an old token cannot survive a partial failure.
type GORMUserRepository struct {
	db *gorm.DB
}

// NewGORMUserRepository constructs a user repository.
func NewGORMUserRepository(db *gorm.DB) *GORMUserRepository {
	return &GORMUserRepository{db: db}
}

// List returns live users matching the filters in created_at/id order.
func (r *GORMUserRepository) List(ctx context.Context, filter ListUsersFilter) ([]*domain.User, int64, error) {
	query := r.db.WithContext(ctx).Model(&models.User{}).Where("deleted_at IS NULL")
	if filter.Role != "" {
		query = query.Where("role = ?", filter.Role)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("(id LIKE ? OR username LIKE ? OR display_name LIKE ?)", like, like, like)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count users: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	var rows []models.User
	if err := query.Order("created_at ASC, id ASC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list users: %w", err)
	}
	out := make([]*domain.User, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainUser(&rows[i]))
	}
	return out, total, nil
}

// Get returns one live user or domain.UserNotFoundError.
func (r *GORMUserRepository) Get(ctx context.Context, id string) (*domain.User, error) {
	var row models.User
	err := r.db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, &domain.UserNotFoundError{UserID: id}
	}
	if err != nil {
		return nil, fmt.Errorf("get user %q: %w", id, err)
	}
	return toDomainUser(&row), nil
}

// Create persists a new active account with the supplied bcrypt hash.
func (r *GORMUserRepository) Create(ctx context.Context, user *domain.User, passwordHash string) error {
	row := &models.User{
		ID:           user.ID,
		TenantID:     user.TenantID,
		Username:     user.Username,
		PasswordHash: passwordHash,
		DisplayName:  user.DisplayName,
		Role:         string(user.Role),
		Status:       models.UserStatus(user.Status),
	}
	if err := r.db.WithContext(ctx).Create(row).Error; err != nil {
		if isUniqueViolation(err) {
			return &domain.UsernameTakenError{Username: user.Username}
		}
		return fmt.Errorf("create user %q: %w", user.Username, err)
	}
	user.CreatedAt = row.CreatedAt
	user.UpdatedAt = row.UpdatedAt
	return nil
}

// UpdateProfile applies display_name / role and returns the persisted row.
func (r *GORMUserRepository) UpdateProfile(ctx context.Context, id string, input domain.UpdateUserInput) (*domain.User, error) {
	updates := map[string]any{}
	if input.DisplayName != nil {
		updates["display_name"] = strings.TrimSpace(*input.DisplayName)
	}
	if input.Role != nil {
		updates["role"] = string(*input.Role)
	}
	result := r.db.WithContext(ctx).Model(&models.User{}).
		Where("id = ? AND deleted_at IS NULL", id).
		Updates(updates)
	if result.Error != nil {
		return nil, fmt.Errorf("update user %q: %w", id, result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, &domain.UserNotFoundError{UserID: id}
	}
	return r.Get(ctx, id)
}

// UpdateStatus changes the account state; disabling revokes every session.
func (r *GORMUserRepository) UpdateStatus(ctx context.Context, id string, status domain.UserStatus) (*domain.User, error) {
	var updated *domain.User
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row models.User
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &domain.UserNotFoundError{UserID: id}
			}
			return fmt.Errorf("get user %q: %w", id, err)
		}
		if err := tx.Model(&row).Update("status", string(status)).Error; err != nil {
			return fmt.Errorf("update user %q status: %w", id, err)
		}
		if status == domain.UserStatusDisabled {
			if err := deleteSessionsByUserID(tx, id); err != nil {
				return err
			}
		}
		row.Status = models.UserStatus(status)
		updated = toDomainUser(&row)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

// UpdatePassword stores a new bcrypt hash and revokes every session.
func (r *GORMUserRepository) UpdatePassword(ctx context.Context, id, passwordHash string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row models.User
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &domain.UserNotFoundError{UserID: id}
			}
			return fmt.Errorf("get user %q: %w", id, err)
		}
		if err := tx.Model(&row).Update("password_hash", passwordHash).Error; err != nil {
			return fmt.Errorf("update user %q password: %w", id, err)
		}
		return deleteSessionsByUserID(tx, id)
	})
}

// Delete soft-deletes an account and revokes every session.
func (r *GORMUserRepository) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var row models.User
		if err := tx.Where("id = ? AND deleted_at IS NULL", id).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return &domain.UserNotFoundError{UserID: id}
			}
			return fmt.Errorf("get user %q: %w", id, err)
		}
		if err := tx.Model(&row).Update("deleted_at", time.Now()).Error; err != nil {
			return fmt.Errorf("delete user %q: %w", id, err)
		}
		return deleteSessionsByUserID(tx, id)
	})
}

// CountActiveAdmins counts live, active administrators. excludeUserID is used
// by the last-admin guard so the target itself is not counted.
func (r *GORMUserRepository) CountActiveAdmins(ctx context.Context, excludeUserID string) (int64, error) {
	query := r.db.WithContext(ctx).Model(&models.User{}).
		Where("role = ? AND status = ? AND deleted_at IS NULL", models.UserRoleAdmin, models.UserStatusActive)
	if excludeUserID != "" {
		query = query.Where("id <> ?", excludeUserID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count active admins: %w", err)
	}
	return count, nil
}

// SessionRepository removes sessions when access is revoked. It is exposed for
// M03 reuse; GORMUserRepository performs the same cleanup transactionally.
type SessionRepository interface {
	DeleteByUserID(ctx context.Context, userID string) error
}

// GORMSessionRepository is the GORM-backed session repository.
type GORMSessionRepository struct {
	db *gorm.DB
}

// NewGORMSessionRepository constructs a session repository.
func NewGORMSessionRepository(db *gorm.DB) *GORMSessionRepository {
	return &GORMSessionRepository{db: db}
}

// DeleteByUserID removes every session of a user.
func (r *GORMSessionRepository) DeleteByUserID(ctx context.Context, userID string) error {
	if err := deleteSessionsByUserID(r.db.WithContext(ctx), userID); err != nil {
		return err
	}
	return nil
}

func deleteSessionsByUserID(tx *gorm.DB, userID string) error {
	if err := tx.Where("user_id = ?", userID).Delete(&models.Session{}).Error; err != nil {
		return fmt.Errorf("delete sessions of user %q: %w", userID, err)
	}
	return nil
}

func toDomainUser(row *models.User) *domain.User {
	return &domain.User{
		ID:          row.ID,
		TenantID:    row.TenantID,
		Username:    row.Username,
		DisplayName: row.DisplayName,
		Role:        domain.UserRole(row.Role),
		Status:      domain.UserStatus(row.Status),
		LastLoginAt: row.LastLoginAt,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
	}
}
