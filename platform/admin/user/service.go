package user

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"golang.org/x/crypto/bcrypt"
)

// 校验规则（PRD 空白项，自定并留痕 dev-feedback）：
//   - username / display_name trim 后非空，长度上限取 DB 列宽 64 / 100；
//   - 密码最小 8 位、最大 72 字节（bcrypt 输入上限）。
const (
	minPasswordLength = 8
	maxPasswordBytes  = 72 // bcrypt 输入上限
	maxUsernameLength = 64
	maxDisplayNameLen = 100
)

// Sentinel errors mapped by the handler layer to the standard errorType
// enumeration (03_API_Standard §3).
var (
	// ErrNotFound indicates the target user does not exist (-> 404 not_found).
	ErrNotFound = errors.New("user not found")
	// ErrUsernameTaken indicates the username is already registered (-> 409 conflict).
	ErrUsernameTaken = errors.New("username already exists")
)

// ValidationError marks a client-side input violation (-> 400 bad_request);
// the message is safe to echo back to the client.
type ValidationError struct{ msg string }

// Error returns the validation failure detail.
func (e *ValidationError) Error() string { return e.msg }

func newValidationError(format string, args ...interface{}) *ValidationError {
	return &ValidationError{msg: fmt.Sprintf(format, args...)}
}

// Service 承载用户管理与登录日志查询的业务规则：输入校验、bcrypt 哈希、
// 会话失效（禁用 / 重置密码时删除该用户全部会话）。
type Service struct {
	repo *Repository
}

// NewService constructs a Service on top of repo.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// CreateUserInput carries the fields accepted at user creation. tenant_id 与
// status 不可由客户端指定：MVP 固定 platform_admin / active。role 可选构建
// admin/user（决策 44 两级角色）；空值默认普通用户。
type CreateUserInput struct {
	Username    string
	DisplayName string
	Password    string
	Role        string
}

// normalizeRole 将请求中的角色规约/校验为决策 44 的两级取值：admin / user。
// 空值按普通用户处理；非法取值返回 ValidationError（handler 映射为 400）。
func normalizeRole(role string) (string, error) {
	switch role {
	case "":
		return models.UserRoleUser, nil
	case models.UserRoleAdmin, models.UserRoleUser:
		return role, nil
	default:
		return "", newValidationError("invalid role %q: must be %q or %q", role, models.UserRoleAdmin, models.UserRoleUser)
	}
}

// CreateUser registers a new active user under the MVP platform_admin tenant,
// storing only the bcrypt hash of the initial password.
func (s *Service) CreateUser(in CreateUserInput) (*models.User, error) {
	username := strings.TrimSpace(in.Username)
	displayName := strings.TrimSpace(in.DisplayName)
	if username == "" {
		return nil, newValidationError("username is required")
	}
	if len(username) > maxUsernameLength {
		return nil, newValidationError("username exceeds %d characters", maxUsernameLength)
	}
	if displayName == "" {
		return nil, newValidationError("display_name is required")
	}
	if len(displayName) > maxDisplayNameLen {
		return nil, newValidationError("display_name exceeds %d characters", maxDisplayNameLen)
	}
	if err := validatePassword(in.Password); err != nil {
		return nil, err
	}
	role, err := normalizeRole(in.Role)
	if err != nil {
		return nil, err
	}

	exists, err := s.repo.ExistsByUsername(username)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrUsernameTaken
	}

	id, err := newUserID()
	if err != nil {
		return nil, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	u := &models.User{
		ID:           id,
		TenantID:     models.PlatformAdminTenantID, // MVP 固定 platform_admin
		Username:     username,
		PasswordHash: string(hash),
		DisplayName:  displayName,
		Role:         role, // 由请求指定或在无值时默认 user（决策 44 两级角色）
		Status:       models.UserStatusActive,
	}
	if err := s.repo.Create(u); err != nil {
		return nil, err
	}
	return u, nil
}

// ListUsers returns one page of users plus the全量 total.
func (s *Service) ListUsers(page, pageSize int) ([]models.User, int64, error) {
	return s.repo.ListUsers(page, pageSize)
}

// UpdateDisplayName edits the display name of an existing user. username 为
// 创建后不可变字段（契约快照 §2：请求含该字段由 handler 层拒绝，不进入此处）。
func (s *Service) UpdateDisplayName(id, displayName string) (*models.User, error) {
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		return nil, newValidationError("display_name is required")
	}
	if len(displayName) > maxDisplayNameLen {
		return nil, newValidationError("display_name exceeds %d characters", maxDisplayNameLen)
	}
	u, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	u.DisplayName = displayName
	if err := s.repo.Save(u); err != nil {
		return nil, err
	}
	return u, nil
}

// UpdateRole edits the role (admin/user, 决策 44 两级角色) of an existing user.
func (s *Service) UpdateRole(id, role string) (*models.User, error) {
	r, err := normalizeRole(role)
	if err != nil {
		return nil, err
	}
	u, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	u.Role = r
	if err := s.repo.Save(u); err != nil {
		return nil, err
	}
	return u, nil
}

// UpdateStatus enables or disables a user. 禁用后该用户无法登录且已有会话
// 立即失效（PRD §5.3 / 契约快照 §2）：删除该用户全部 sessions。
func (s *Service) UpdateStatus(id string, status models.UserStatus) (*models.User, error) {
	if status != models.UserStatusActive && status != models.UserStatusDisabled {
		return nil, newValidationError("invalid status %q: must be %q or %q", status, models.UserStatusActive, models.UserStatusDisabled)
	}
	u, err := s.repo.FindByID(id)
	if err != nil {
		return nil, err
	}
	u.Status = status
	if err := s.repo.Save(u); err != nil {
		return nil, err
	}
	if status == models.UserStatusDisabled {
		if err := s.repo.DeleteSessionsByUserID(u.ID); err != nil {
			return nil, err
		}
	}
	return u, nil
}

// ResetPassword replaces the user's password with a new bcrypt hash and
// invalidates all existing sessions of that user (契约快照 §2).
func (s *Service) ResetPassword(id, newPassword string) error {
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	u, err := s.repo.FindByID(id)
	if err != nil {
		return err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	u.PasswordHash = string(hash)
	if err := s.repo.Save(u); err != nil {
		return err
	}
	return s.repo.DeleteSessionsByUserID(u.ID)
}

// DeleteUser 软删除一个普通用户账号并使其全部会话立即失效。平台管理员账号不
// 提供删除（防止误删唯一管理入口，改为禁用）；由此也天然禁止 admin 删除自身或
// 另一位 admin（admin 的 role 已落入该保护，调用者又必为 admin，见 RequireAdmin）。
func (s *Service) DeleteUser(id string) error {
	u, err := s.repo.FindByID(id)
	if err != nil {
		return err
	}
	if u.Role == models.UserRoleAdmin {
		return newValidationError("admin accounts cannot be deleted; disable them instead")
	}
	if err := s.repo.Delete(u.ID); err != nil {
		return err
	}
	return s.repo.DeleteSessionsByUserID(u.ID)
}

// ListLoginLogs returns one page of login logs (created_at desc) plus the全量
// total, optionally filtered by exact username and/or success flag.
func (s *Service) ListLoginLogs(username string, success *bool, page, pageSize int) ([]models.LoginLog, int64, error) {
	return s.repo.ListLoginLogs(username, success, page, pageSize)
}

// validatePassword enforces the MVP password rule（PRD 空白自定项）.
func validatePassword(password string) error {
	if len(password) < minPasswordLength {
		return newValidationError("password must be at least %d characters", minPasswordLength)
	}
	if len(password) > maxPasswordBytes {
		return newValidationError("password must be at most %d bytes (bcrypt limit)", maxPasswordBytes)
	}
	return nil
}

// newUserID 生成 uuid v4 字符串（crypto/rand，无外部依赖；与
// platform/config/resource/create.go 的 newResourceID 同风格）。
func newUserID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate user id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}
