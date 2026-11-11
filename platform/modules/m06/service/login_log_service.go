package service

import (
	"context"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
)

// LoginLogService exposes read-only login attempt queries.
type LoginLogService struct {
	logs repository.LoginLogRepository
}

// NewLoginLogService constructs a login-log service.
func NewLoginLogService(logs repository.LoginLogRepository) *LoginLogService {
	return &LoginLogService{logs: logs}
}

// List returns login logs matching the filters in created_at desc order.
func (s *LoginLogService) List(ctx context.Context, filter repository.ListLoginLogsFilter) ([]*domain.LoginLog, int64, error) {
	if filter.StartTime != nil && filter.EndTime != nil && filter.StartTime.After(*filter.EndTime) {
		return nil, 0, &domain.InvalidTimeRangeError{Message: "start_time must not be later than end_time"}
	}
	return s.logs.List(ctx, filter)
}
