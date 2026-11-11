package handler

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/foundation/httpapi"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

// UserHandler exposes the M06 v3 user administration API.
type UserHandler struct {
	svc *service.UserService
}

// NewUserHandler constructs a user handler.
func NewUserHandler(svc *service.UserService) *UserHandler {
	return &UserHandler{svc: svc}
}

// List handles GET /users.
func (h *UserHandler) List(c *gin.Context) {
	status, err := domain.ParseUserStatus(c.Query("status"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	role, err := domain.ParseUserRole(c.Query("role"))
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	page, pageSize := parsePagination(c)
	users, total, err := h.svc.List(c.Request.Context(), repository.ListUsersFilter{
		Keyword:  strings.TrimSpace(c.Query("keyword")),
		Role:     string(role),
		Status:   string(status),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	list := make([]dto.UserResponse, 0, len(users))
	for _, user := range users {
		list = append(list, dto.FromUser(user))
	}
	response.OK(c, dto.ListUsersResponse{List: list, Total: total, Page: page, PageSize: pageSize})
}

// Create handles POST /users.
func (h *UserHandler) Create(c *gin.Context) {
	var req dto.CreateUserRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	user, err := h.svc.Create(c.Request.Context(), req.ToDomain())
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromUser(user))
}

// Update handles PUT /users/:id.
func (h *UserHandler) Update(c *gin.Context) {
	var req dto.UpdateUserRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, fmt.Errorf("%w; allowed fields: display_name, role", err))
		return
	}
	input := req.ToDomain()
	if !input.HasChanges() {
		response.BadRequest(c, fmt.Errorf("at least one of display_name/role is required"))
		return
	}
	user, err := h.svc.Update(c.Request.Context(), c.Param("id"), input)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromUser(user))
}

// UpdateStatus handles PATCH /users/:id/status.
func (h *UserHandler) UpdateStatus(c *gin.Context) {
	var req dto.UpdateUserStatusRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	user, err := h.svc.UpdateStatus(c.Request.Context(), c.Param("id"), req.Status)
	if err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.FromUser(user))
}

// ResetPassword handles PUT /users/:id/password.
func (h *UserHandler) ResetPassword(c *gin.Context) {
	var req dto.ResetPasswordRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		response.BadRequest(c, err)
		return
	}
	id := c.Param("id")
	if err := h.svc.ResetPassword(c.Request.Context(), id, req.NewPassword); err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.ResetPasswordResponse{ID: id, PasswordReset: true})
}

// Delete handles DELETE /users/:id.
func (h *UserHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.svc.Delete(c.Request.Context(), id); err != nil {
		httpapi.WriteError(c, err)
		return
	}
	response.OK(c, dto.DeleteUserResponse{ID: id, Deleted: true})
}
