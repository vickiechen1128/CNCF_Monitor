package auth

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// Repository 封装轻量认证涉及的 users / sessions / login_logs 持久化访问。
// sessions 为易失态，会话失效（过期/登出/改密/禁用）以行缺失或过期时间为准。
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository backed by db.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// FindUserByUsername returns the user with the given username, or ErrNotFound.
func (r *Repository) FindUserByUsername(username string) (*models.User, error) {
	var u models.User
	err := r.db.First(&u, "username = ?", username).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find user by username %q: %w", username, err)
	}
	return &u, nil
}

// FindUserByID returns the user with the given id, or ErrNotFound.
func (r *Repository) FindUserByID(id string) (*models.User, error) {
	var u models.User
	err := r.db.First(&u, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find user %q: %w", id, err)
	}
	return &u, nil
}

// SaveUser persists mutations of an existing user row (last_login_at / hash).
func (r *Repository) SaveUser(u *models.User) error {
	if err := r.db.Save(u).Error; err != nil {
		return fmt.Errorf("save user %q: %w", u.ID, err)
	}
	return nil
}

// CreateSession persists a newly-issued login session.
func (r *Repository) CreateSession(sess *models.Session) error {
	if err := r.db.Create(sess).Error; err != nil {
		return fmt.Errorf("create session for user %q: %w", sess.UserID, err)
	}
	return nil
}

// FindSessionByToken returns the session with the given opaque token, or
// ErrNotFound. 过期判断由 service 层据此行的 ExpiresAt 完成。
func (r *Repository) FindSessionByToken(token string) (*models.Session, error) {
	var s models.Session
	err := r.db.First(&s, "token = ?", token).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("find session by token: %w", err)
	}
	return &s, nil
}

// DeleteSessionByToken removes the session row identified by token（幂等，供
// logout 使用；会话不存在同样视为登出成功）。
func (r *Repository) DeleteSessionByToken(token string) error {
	if err := r.db.Where("token = ?", token).Delete(&models.Session{}).Error; err != nil {
		return fmt.Errorf("delete session by token: %w", err)
	}
	return nil
}

// DeleteSessionsByUserID 物理删除该用户全部会话行（改密/禁用后立即失效）。
func (r *Repository) DeleteSessionsByUserID(userID string) error {
	if err := r.db.Where("user_id = ?", userID).Delete(&models.Session{}).Error; err != nil {
		return fmt.Errorf("delete sessions of user %q: %w", userID, err)
	}
	return nil
}

// CreateLoginLog persists one login attempt record（成功或失败均写）。
func (r *Repository) CreateLoginLog(log *models.LoginLog) error {
	if err := r.db.Create(log).Error; err != nil {
		return fmt.Errorf("create login log for %q: %w", log.Username, err)
	}
	return nil
}