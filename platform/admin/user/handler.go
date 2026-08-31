// Package user implements Module_06 用户管理与登录日志查询 API（MVP，决策 44）
// — 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md §6.3
// 与 docs/05-execution-records/module-06/track-b-increment-decision-44/api-contract-snapshot.md §2。
package user

import (
	"errors"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// RegisterRoutes mounts the Module 06 user-admin and login-log endpoints under
// an `/api/v2/platform` sub-group (the caller passes the platform group).
// 认证中间件由 au-02 统一挂载，本任务路由与现网其它管理接口一致暂不鉴权。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	h := NewHandler(NewService(NewRepository(db)))
	platform.GET("/users", h.ListUsers)
	platform.POST("/users", h.CreateUser)
	platform.PUT("/users/:id", h.UpdateUser)
	platform.PATCH("/users/:id/status", h.UpdateUserStatus)
	platform.PUT("/users/:id/password", h.ResetPassword)
	platform.DELETE("/users/:id", h.DeleteUser)
	platform.GET("/login-logs", h.ListLoginLogs)
}

// Handler adapts the user Service to HTTP, enforcing the unified response
// envelope and standard errorType mapping.
type Handler struct {
	svc *Service
}

// NewHandler constructs a Handler.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// userDTO 是用户对象的对外序列化形态（契约快照 §2 字段集），绝不包含
// password_hash / tenant_id 等未列字段。
type userDTO struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	Role        string     `json:"role"` // admin / user（H-2 新增，便于前端识别管理员）
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"last_login_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func toUserDTO(u *models.User) userDTO {
	return userDTO{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		Role:        u.Role,
		Status:      string(u.Status),
		LastLoginAt: u.LastLoginAt,
		CreatedAt:   u.CreatedAt,
	}
}

// loginLogDTO 是登录日志的对外序列化形态（契约快照 §2 字段集）；message 为
// 仅技术信息，不在列表接口返回。
type loginLogDTO struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Success   bool      `json:"success"`
	IP        string    `json:"ip,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

func toLoginLogDTO(l *models.LoginLog) loginLogDTO {
	return loginLogDTO{
		ID:        l.ID,
		Username:  l.Username,
		Success:   l.Success,
		IP:        l.IP,
		CreatedAt: l.CreatedAt,
	}
}

// createUserRequest is the body for POST /users（契约快照 §2）.
type createUserRequest struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
	Role        string `json:"role"` // admin / user，缺省 user（决策 44 两级角色）
}

// updateUserRequest is the body for PUT /users/:id。Username 用指针以区分
// 「字段未出现」与「字段出现」：契约快照 §2 规定请求含 username 即 400
// （username 创建后不可变）。display_name 与 role 均仅编辑对应维度。
type updateUserRequest struct {
	Username    *string `json:"username"`
	DisplayName string  `json:"display_name"`
	Role        *string `json:"role"` // 可选；出现时校验并更新 admin/user
}

// updateStatusRequest is the body for PATCH /users/:id/status.
type updateStatusRequest struct {
	Status string `json:"status"`
}

// resetPasswordRequest is the body for PUT /users/:id/password.
type resetPasswordRequest struct {
	NewPassword string `json:"new_password"`
}

// CreateUser handles POST /api/v2/platform/users.
func (h *Handler) CreateUser(c *gin.Context) {
	var req createUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	u, err := h.svc.CreateUser(CreateUserInput{
		Username:    req.Username,
		DisplayName: req.DisplayName,
		Password:    req.Password,
		Role:        req.Role,
	})
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, toUserDTO(u))
}

// ListUsers handles GET /api/v2/platform/users，响应 data = {items, total}
// （契约快照 §2 信封）。
func (h *Handler) ListUsers(c *gin.Context) {
	page, pageSize := parsePage(c)
	list, total, err := h.svc.ListUsers(page, pageSize)
	if err != nil {
		writeError(c, err)
		return
	}
	items := make([]userDTO, 0, len(list))
	for i := range list {
		items = append(items, toUserDTO(&list[i]))
	}
	response.OK(c, gin.H{"items": items, "total": total})
}

// UpdateUser handles PUT /api/v2/platform/users/:id（display_name 与 role 可编辑）。
func (h *Handler) UpdateUser(c *gin.Context) {
	var req updateUserRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	if req.Username != nil {
		response.BadRequest(c, errors.New("username is immutable after creation; remove it from the request"))
		return
	}
	u, err := h.svc.UpdateDisplayName(c.Param("id"), req.DisplayName)
	if err != nil {
		writeError(c, err)
		return
	}
	if req.Role != nil {
		u, err = h.svc.UpdateRole(c.Param("id"), *req.Role)
		if err != nil {
			writeError(c, err)
			return
		}
	}
	response.OK(c, toUserDTO(u))
}

// UpdateUserStatus handles PATCH /api/v2/platform/users/:id/status.
func (h *Handler) UpdateUserStatus(c *gin.Context) {
	var req updateStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	u, err := h.svc.UpdateStatus(c.Param("id"), models.UserStatus(req.Status))
	if err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, toUserDTO(u))
}

// DeleteUser handles DELETE /api/v2/platform/users/:id（仅软删普通用户；管理员
// 账号不提供删除，以禁用替代）。
func (h *Handler) DeleteUser(c *gin.Context) {
	if err := h.svc.DeleteUser(c.Param("id")); err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, nil)
}

// ResetPassword handles PUT /api/v2/platform/users/:id/password（管理员重置）。
func (h *Handler) ResetPassword(c *gin.Context) {
	var req resetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, errInvalidPayload(err))
		return
	}
	if err := h.svc.ResetPassword(c.Param("id"), req.NewPassword); err != nil {
		writeError(c, err)
		return
	}
	response.OK(c, nil)
}

// ListLoginLogs handles GET /api/v2/platform/login-logs，响应 data =
// {items, total}，按 created_at 倒序（契约快照 §2）。
func (h *Handler) ListLoginLogs(c *gin.Context) {
	page, pageSize := parsePage(c)
	var success *bool
	if raw := c.Query("success"); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			response.BadRequest(c, errors.New(`invalid success filter: must be "true" or "false"`))
			return
		}
		success = &v
	}
	list, total, err := h.svc.ListLoginLogs(c.Query("username"), success, page, pageSize)
	if err != nil {
		writeError(c, err)
		return
	}
	items := make([]loginLogDTO, 0, len(list))
	for i := range list {
		items = append(items, toLoginLogDTO(&list[i]))
	}
	response.OK(c, gin.H{"items": items, "total": total})
}

// writeError maps service-layer errors to the standard errorType enumeration
// (03_API_Standard §3): ValidationError->bad_request, ErrNotFound->not_found,
// ErrUsernameTaken->conflict, anything else->internal.
func writeError(c *gin.Context, err error) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		response.BadRequest(c, ve)
	case errors.Is(err, ErrNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrUsernameTaken):
		response.Conflict(c, err)
	default:
		response.InternalServerError(c, err)
	}
}

// errInvalidPayload wraps a JSON binding failure as a bad_request detail.
func errInvalidPayload(err error) error {
	return errors.New("invalid request payload: " + err.Error())
}

// parsePage parses page / page_size per API 标准 §7.2（page 从 1 开始，默认
// page_size=20，上限 100）。
func parsePage(c *gin.Context) (int, int) {
	page := parseIntDefault(c.Query("page"), 1)
	pageSize := parseIntDefault(c.Query("page_size"), defaultPageSize)
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

func parseIntDefault(raw string, def int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return def
	}
	return v
}
