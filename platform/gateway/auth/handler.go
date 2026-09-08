package auth

import (
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"gorm.io/gorm"
)

// RegisterRoutes mounts the Module_03 轻量认证 endpoints under an
// `/api/v2/platform` sub-group（路由为 /auth/*）。认证中间件由 au-02 统一挂载，
// 本任务只实现认证 API 与写 LoginLog，不做鉴权。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	h := NewHandler(NewService(NewRepository(db)))
	g := platform.Group("/auth")
	g.POST("/login", h.Login)
	g.POST("/logout", h.Logout)
	g.GET("/me", h.Me)
	g.PUT("/password", h.ChangePassword)
}

// Handler adapts the auth Service to HTTP, enforcing the unified response
// envelope and standard errorType mapping.
type Handler struct {
	svc *Service
}

// NewHandler constructs a Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// loginUserDTO 是 login 成功响应中 user 的对外形态（契约快照 §1 字段集），
// 不含 password_hash / last_login_at，绝不输出哈希或明文。
type loginUserDTO struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	TenantID    string `json:"tenant_id"`
	Role        string `json:"role"` // admin / user（H-2 新增，便于前端识别管理员）
}

// meDTO 是 GET /auth/me 的响应形态（契约快照 §1：含 last_login_at）。
type meDTO struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	TenantID    string     `json:"tenant_id"`
	Role        string     `json:"role"` // admin / user（H-2 新增）
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
}

// loginRequest is the body for POST /auth/login.
type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// changePasswordRequest is the body for PUT /auth/password.
type changePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

// Login handles POST /api/v2/platform/auth/login。
func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	res, err := h.svc.Login(req.Username, req.Password, c.ClientIP())
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, gin.H{
		"token": res.Token,
		"expires_at": res.ExpiresAt,
		"user": loginUserDTO{
			ID:          res.User.ID,
			Username:    res.User.Username,
			DisplayName: res.User.DisplayName,
			TenantID:    res.User.TenantID,
			Role:        res.User.Role,
		},
	})
}

// Logout handles POST /api/v2/platform/auth/logout（幂等：会话失效即成功）。
func (h *Handler) Logout(c *gin.Context) {
	if err := h.svc.Logout(bearerToken(c)); err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, nil)
}

// Me handles GET /api/v2/platform/auth/me：按 Token 解析当前用户。
func (h *Handler) Me(c *gin.Context) {
	u, err := h.svc.Authenticate(bearerToken(c))
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, meDTO{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		TenantID:    u.TenantID,
		Role:        u.Role,
		LastLoginAt: u.LastLoginAt,
	})
}

// ChangePassword handles PUT /api/v2/platform/auth/password（自助改密）。
func (h *Handler) ChangePassword(c *gin.Context) {
	token := bearerToken(c)
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	if err := h.svc.ChangePassword(token, req.OldPassword, req.NewPassword); err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, nil)
}

// bearerToken extracts the opaque token from the Authorization: Bearer header,
// or "" if absent/malformed.
func bearerToken(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	if len(h) > 7 && strings.EqualFold(h[:7], "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

// writeError maps service-layer errors to the standard errorType enumeration
// (03_API_Standard §3): ValidationError->bad_request，其余认证失败->unauthorized，
// 其它->internal。
func writeError(c *gin.Context, err error) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		response.BadRequest(c, ve)
	case errors.Is(err, ErrInvalidCredentials):
		response.Unauthorized(c, ErrInvalidCredentials.Error())
	case errors.Is(err, ErrInvalidOldPassword):
		response.Unauthorized(c, ErrInvalidOldPassword.Error())
	case errors.Is(err, ErrUnauthorized):
		response.Unauthorized(c, ErrUnauthorized.Error())
	case errors.Is(err, ErrLoginLocked):
		response.TooManyRequests(c, ErrLoginLocked.Error())
	default:
		response.InternalServerError(c, err)
	}
}

// errInvalidPayload wraps a JSON binding failure as a bad_request detail.
func errInvalidPayload(err error) error {
	return errors.New("invalid request payload: " + err.Error())
}