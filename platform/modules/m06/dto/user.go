package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// ListUsersResponse is the v3 pagination envelope for users.
type ListUsersResponse struct {
	List     []UserResponse `json:"list"`
	Total    int64          `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
}

// UserResponse is the administrative user representation. PasswordHash is
// deliberately absent and must never be serialized.
type UserResponse struct {
	ID          string     `json:"id"`
	TenantID    string     `json:"tenant_id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"display_name"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
}

// CreateUserRequest is the POST /users body. tenant_id and status are
// server-owned; the strict decoder rejects them as unknown fields.
type CreateUserRequest struct {
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
	Role        string `json:"role"`
}

// ToDomain converts the request to the service input.
func (r CreateUserRequest) ToDomain() domain.CreateUserInput {
	return domain.CreateUserInput{
		Username:    r.Username,
		DisplayName: r.DisplayName,
		Password:    r.Password,
		Role:        r.Role,
	}
}

// UpdateUserRequest is the PUT /users/:id body. Only display_name and role are
// mutable; username/tenant_id/status/id are rejected by the strict decoder.
type UpdateUserRequest struct {
	DisplayName *string `json:"display_name"`
	Role        *string `json:"role"`
}

// ToDomain converts the request to the service input.
func (r UpdateUserRequest) ToDomain() domain.UpdateUserInput {
	return domain.UpdateUserInput{DisplayName: r.DisplayName, Role: r.Role}
}

// UpdateUserStatusRequest is the PATCH /users/:id/status body.
type UpdateUserStatusRequest struct {
	Status string `json:"status"`
}

// ResetPasswordRequest is the PUT /users/:id/password body.
type ResetPasswordRequest struct {
	NewPassword string `json:"new_password"`
}

// DeleteUserResponse is the DELETE /users/:id response.
type DeleteUserResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

// ResetPasswordResponse is the PUT /users/:id/password response.
type ResetPasswordResponse struct {
	ID            string `json:"id"`
	PasswordReset bool   `json:"password_reset"`
}

// FromUser converts a domain user to the v3 representation.
func FromUser(user *domain.User) UserResponse {
	return UserResponse{
		ID:          user.ID,
		TenantID:    user.TenantID,
		Username:    user.Username,
		DisplayName: user.DisplayName,
		Role:        string(user.Role),
		Status:      string(user.Status),
		LastLoginAt: user.LastLoginAt,
		CreatedAt:   user.CreatedAt,
	}
}
