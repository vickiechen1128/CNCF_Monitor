// Package auth 实现 Module_03 §4.0 轻量认证 API（决策 44 / Track B+）：
// login / logout / me / 自助改密，并承接会话校验查询供 au-02 认证中间件复用。
// 安全要求：密码 bcrypt 校验、Token 不透明随机、改密后旧会话全部失效、
// 登录失败统一 401 不区分原因（防账号枚举）、任何接口不泄露密码哈希/明文。
package auth

import (
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"golang.org/x/crypto/bcrypt"
)

// 密码规则（与 tu-03 保持一致）：最小 8 位、最大 72 字节（bcrypt 输入上限）。
const (
	minPasswordLength = 8
	maxPasswordBytes  = 72
)

// Sentinel errors，由 handler 层映射到 API 标准 §3 的 errorType 枚举。
var (
	// ErrNotFound 表示目标不存在（repository 层使用；handler 层对认证接口将其
	// 归一为 unauthorized 或内部错误，不对外区分资源是否存在的细节）。
	ErrNotFound = errors.New("resource not found")
	// ErrInvalidCredentials 表示登录失败（账号不存在/密码错误/被禁用统一使用，
	// 对外文案统一为「用户名或密码错误」，防账号枚举；-> 401 unauthorized）。
	ErrInvalidCredentials = errors.New("用户名或密码错误")
	// ErrInvalidOldPassword 表示自助改密时旧密码校验失败（-> 401 unauthorized）。
	ErrInvalidOldPassword = errors.New("旧密码错误")
	// ErrUnauthorized 表示缺少/无效/过期会话，或用户非 active（-> 401 unauthorized）。
	ErrUnauthorized = errors.New("未认证或会话已失效")
	// ErrLoginLocked 表示同一用户名连续失败达阈值的临时锁定期间再次登录被拒
	// （-> 429 too_many_requests；M-1 登录失败限流）。
	ErrLoginLocked = errors.New("尝试次数过多，请稍后再试")
)

// M-1 登录失败速率限制（进程内、单实例；MVP 不追求跨实例一致性，分布式限流
// 留待 v1.x）。规则：同一用户名 loginFailThreshold 次连续失败，在 loginFailWindow
// 窗口内即触发锁定，锁定 loginLockDuration 一段时间内拒绝该用户名登录。
const (
	loginFailThreshold = 5
	loginFailWindow    = 15 * time.Minute
	loginLockDuration  = 15 * time.Minute
)

// loginAttempt 记录某用户名在滑动窗口内的失败计数与锁定截止时间。
type loginAttempt struct {
	count       int
	windowStart time.Time
	lockedUntil time.Time
}

// loginRateLimiter 是在进程内实现登录失败限流的并发安全记账器。
type loginRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*loginAttempt
}

// newLoginRateLimiter 构造一个空的限流记账器。
func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{entries: make(map[string]*loginAttempt)}
}

// checkLocked 报告 username 当前是否处于锁定期（锁定已过期则自动解除）。
func (l *loginRateLimiter) checkLocked(username string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[username]
	if e == nil {
		return false
	}
	if now.Before(e.lockedUntil) {
		return true
	}
	e.lockedUntil = time.Time{}
	return false
}

// recordFailure 记录一次失败尝试；当窗口内连续失败数达到阈值时标记锁定并返回
// true（调用方据此在数秒后即可见到 checkLocked 为真）。
func (l *loginRateLimiter) recordFailure(username string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[username]
	if e == nil {
		e = &loginAttempt{}
		l.entries[username] = e
	}
	// 窗口过期则重置计数与窗口起点。
	if now.Sub(e.windowStart) >= loginFailWindow {
		e.windowStart = now
		e.count = 0
	}
	e.count++
	if e.count >= loginFailThreshold {
		e.lockedUntil = now.Add(loginLockDuration)
		e.windowStart = now
		e.count = 0
		return true
	}
	return false
}

// reset 清除该用户名的全部失败记账（登录成功后调用，避免成功后仍被旧失败计数）。
func (l *loginRateLimiter) reset(username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.entries, username)
}

// ValidationError 标记客户端输入违规（-> 400 bad_request）；message 安全可回显。
type ValidationError struct{ msg string }

// Error returns the validation failure detail.
func (e *ValidationError) Error() string { return e.msg }

func newValidationError(format string, args ...interface{}) *ValidationError {
	return &ValidationError{msg: fmt.Sprintf(format, args...)}
}

// Service 承载轻量认证业务规则与访问会话的查询，供本包 handler 与 au-02
// 认证中间件复用。
type Service struct {
	repo    *Repository
	limiter *loginRateLimiter // M-1 登录失败限流（进程内）
}

// NewService constructs a Service on top of repo.
func NewService(repo *Repository) *Service {
	return &Service{repo: repo, limiter: newLoginRateLimiter()}
}

// LoginResult carries the artifacts produced by a successful login.
type LoginResult struct {
	Token     string
	ExpiresAt time.Time
	User      *models.User
}

// Login authenticates a user by username/password, starts a server-side session,
// stamps last_login_at, and records a successful LoginLog. On any failure it
// records a failure LoginLog and returns ErrInvalidCredentials with a unified
// message (M-2：均使用「用户名或密码错误」入库，绝不泄露账号存在性), never
// distinguishing "no such account" from "wrong password". M-1：同一用户名连续
// 失败达阈值后进入锁定期，锁定期内的尝试直接返回 ErrLoginLocked。
func (s *Service) Login(username, password, ip string) (*LoginResult, error) {
	username = strings.TrimSpace(username)
	now := time.Now().UTC()
	if s.limiter.checkLocked(username, now) {
		// 锁定期：直接拒绝，不写 LoginLog（避免对攻击者刷日志放大存储）。
		return nil, ErrLoginLocked
	}
	user, err := s.repo.FindUserByUsername(username)
	if errors.Is(err, ErrNotFound) {
		s.limiter.recordFailure(username, now)
		s.logLogin(username, false, ErrInvalidCredentials.Error(), ip)
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if user.Status != models.UserStatusActive {
		s.limiter.recordFailure(username, now)
		s.logLogin(username, false, ErrInvalidCredentials.Error(), ip)
		return nil, ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)) != nil {
		s.limiter.recordFailure(username, now)
		s.logLogin(username, false, ErrInvalidCredentials.Error(), ip)
		return nil, ErrInvalidCredentials
	}

	// 凭据正确：解除失败记账，签发会话并更新最后登录时间。
	s.limiter.reset(username)
	expiresAt := now.Add(models.SessionTTL)
	sessID, err := newID()
	if err != nil {
		return nil, err
	}
	user.LastLoginAt = &now
	if err := s.repo.SaveUser(user); err != nil {
		return nil, fmt.Errorf("stamp last_login_at: %w", err)
	}
	token, err := generateToken()
	if err != nil {
		return nil, err
	}
	sess := &models.Session{
		ID:        sessID,
		Token:     token,
		UserID:    user.ID,
		ExpiresAt: expiresAt,
		CreatedAt: now,
	}
	if err := s.repo.CreateSession(sess); err != nil {
		return nil, err
	}
	s.logLogin(username, true, "", ip)
	return &LoginResult{Token: token, ExpiresAt: expiresAt, User: user}, nil
}

// Logout invalidates the session carrying token（幂等：会话不存在同样视为登出
// 成功）。token 为空返回 ErrUnauthorized。
func (s *Service) Logout(token string) error {
	if strings.TrimSpace(token) == "" {
		return ErrUnauthorized
	}
	return s.repo.DeleteSessionByToken(token)
}

// Authenticate resolves token to the current active user，供 me/password 及
// au-02 认证中间件复用。校验：token 有会话、未过期、用户存在且为 active。
// 任一不满足返回 ErrUnauthorized。
func (s *Service) Authenticate(token string) (*models.User, error) {
	if strings.TrimSpace(token) == "" {
		return nil, ErrUnauthorized
	}
	sess, err := s.repo.FindSessionByToken(token)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(sess.ExpiresAt) {
		return nil, ErrUnauthorized
	}
	u, err := s.repo.FindUserByID(sess.UserID)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if u.Status != models.UserStatusActive {
		return nil, ErrUnauthorized
	}
	return u, nil
}

// ChangePassword lets the current user self-change their password: it verifies
// oldPassword, stores a fresh bcrypt hash of newPassword, and invalidates all of
// that user's server-side sessions（含当前会话），使旧会话全部失效。
func (s *Service) ChangePassword(token, oldPassword, newPassword string) error {
	user, err := s.Authenticate(token)
	if err != nil {
		return err
	}
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)) != nil {
		return ErrInvalidOldPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	user.PasswordHash = string(hash)
	if err := s.repo.SaveUser(user); err != nil {
		return err
	}
	return s.repo.DeleteSessionsByUserID(user.ID)
}

// logLogin 尽力写一条登录日志（成功或失败）；写失败仅记日志，不阻断主流程。
// message 仅承载技术性诊断信息，绝不含明文密码或哈希。
func (s *Service) logLogin(username string, success bool, message, ip string) {
	id, err := newID()
	if err != nil {
		log.Printf("auth: generate login log id: %v", err)
		return
	}
	err = s.repo.CreateLoginLog(&models.LoginLog{
		ID:        id,
		Username:  username,
		Success:   success,
		IP:        ip,
		Message:   message,
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		log.Printf("auth: write login log for %q: %v", username, err)
	}
}

// validatePassword enforces the MVP password rule（与 tu-03 保持一致）.
func validatePassword(password string) error {
	if len(password) < minPasswordLength {
		return newValidationError("password must be at least %d characters", minPasswordLength)
	}
	if len(password) > maxPasswordBytes {
		return newValidationError("password must be at most %d bytes (bcrypt limit)", maxPasswordBytes)
	}
	return nil
}