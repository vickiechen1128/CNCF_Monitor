package user

import (
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 分页参数约定（API 标准 §7.2）：page 从 1 开始，默认 page_size=20，上限 100。
const (
	defaultPageSize = 20
	maxPageSize     = 100
)

// Repository 封装 users / sessions / login_logs 三张表的持久化访问。
type Repository struct {
	db *gorm.DB
}

// NewRepository constructs a Repository backed by db.
func NewRepository(db *gorm.DB) *Repository {
	return &Repository{db: db}
}

// ExistsByUsername reports whether a user with the given username already
// exists (soft-deleted rows excluded; username 有唯一索引兜底并发场景).
func (r *Repository) ExistsByUsername(username string) (bool, error) {
	var count int64
	if err := r.db.Model(&models.User{}).Where("username = ?", username).Count(&count).Error; err != nil {
		return false, fmt.Errorf("count user by username %q: %w", username, err)
	}
	return count > 0, nil
}

// Create persists a new user row.
func (r *Repository) Create(u *models.User) error {
	if err := r.db.Create(u).Error; err != nil {
		if isUniqueConstraintError(err) {
			return ErrUsernameTaken
		}
		return fmt.Errorf("create user %q: %w", u.Username, err)
	}
	return nil
}

// FindByID returns the user with the given id, or ErrNotFound.
func (r *Repository) FindByID(id string) (*models.User, error) {
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

// ListUsers returns a page of users ordered by created_at asc plus the total
// count (全量总数，非当前页条数).
func (r *Repository) ListUsers(page, pageSize int) ([]models.User, int64, error) {
	var total int64
	if err := r.db.Model(&models.User{}).Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count users: %w", err)
	}
	list := []models.User{}
	if err := r.db.Order("created_at asc").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list users: %w", err)
	}
	return list, total, nil
}

// Save persists mutations of an existing user row.
func (r *Repository) Save(u *models.User) error {
	if err := r.db.Save(u).Error; err != nil {
		return fmt.Errorf("save user %q: %w", u.ID, err)
	}
	return nil
}

// Delete 软删除指定用户（User 内嵌 DeletedAt，GORM 执行逻辑删除），目标不存在
// 时返回 ErrNotFound。
func (r *Repository) Delete(id string) error {
	res := r.db.Delete(&models.User{}, "id = ?", id)
	if res.Error != nil {
		return fmt.Errorf("delete user %q: %w", id, res.Error)
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteSessionsByUserID 物理删除该用户的全部会话行，使已有会话立即失效
// （sessions 为易失态：删除后认证中间件查不到即视为失效，au-01 复用此语义）。
func (r *Repository) DeleteSessionsByUserID(userID string) error {
	if err := r.db.Where("user_id = ?", userID).Delete(&models.Session{}).Error; err != nil {
		return fmt.Errorf("delete sessions of user %q: %w", userID, err)
	}
	return nil
}

// ListLoginLogs returns a page of login logs ordered by created_at desc plus
// the total count. username 为空串表示不筛选（精确匹配）；success 为 nil 表示
// 不筛选。
func (r *Repository) ListLoginLogs(username string, success *bool, page, pageSize int) ([]models.LoginLog, int64, error) {
	q := r.db.Model(&models.LoginLog{})
	if username != "" {
		q = q.Where("username = ?", username)
	}
	if success != nil {
		q = q.Where("success = ?", *success)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count login logs: %w", err)
	}
	list := []models.LoginLog{}
	if err := q.Order("created_at desc").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&list).Error; err != nil {
		return nil, 0, fmt.Errorf("list login logs: %w", err)
	}
	return list, total, nil
}

// isUniqueConstraintError reports whether err is a SQLite UNIQUE constraint
// violation, which we map to HTTP 409 (与 networkdomain 同策略).
func isUniqueConstraintError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint")
}
