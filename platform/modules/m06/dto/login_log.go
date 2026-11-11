package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// ListLoginLogsResponse is the v3 pagination envelope for login logs.
type ListLoginLogsResponse struct {
	List     []LoginLogResponse `json:"list"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"page_size"`
}

// LoginLogResponse is the read-only login attempt view. The diagnostic message
// column is intentionally not exposed.
type LoginLogResponse struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Success   bool      `json:"success"`
	IP        string    `json:"ip,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// FromLoginLog converts a domain login log to the v3 representation.
func FromLoginLog(log *domain.LoginLog) LoginLogResponse {
	return LoginLogResponse{
		ID:        log.ID,
		Username:  log.Username,
		Success:   log.Success,
		IP:        log.IP,
		CreatedAt: log.CreatedAt,
	}
}
