package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
	"gorm.io/gorm"
)

// ListLoginLogsFilter carries login-log filters. Success nil means "no filter".
type ListLoginLogsFilter struct {
	Username  string
	Success   *bool
	StartTime *time.Time
	EndTime   *time.Time
	Page      int
	PageSize  int
}

// LoginLogRepository reads login attempt records.
type LoginLogRepository interface {
	List(ctx context.Context, filter ListLoginLogsFilter) ([]*domain.LoginLog, int64, error)
}

// GORMLoginLogRepository is the GORM-backed login-log reader.
type GORMLoginLogRepository struct {
	db *gorm.DB
}

// NewGORMLoginLogRepository constructs a login-log repository.
func NewGORMLoginLogRepository(db *gorm.DB) *GORMLoginLogRepository {
	return &GORMLoginLogRepository{db: db}
}

// List returns login logs in created_at desc order.
func (r *GORMLoginLogRepository) List(ctx context.Context, filter ListLoginLogsFilter) ([]*domain.LoginLog, int64, error) {
	query := r.db.WithContext(ctx).Model(&models.LoginLog{})
	if username := strings.TrimSpace(filter.Username); username != "" {
		query = query.Where("username = ?", username)
	}
	if filter.Success != nil {
		query = query.Where("success = ?", *filter.Success)
	}
	if filter.StartTime != nil {
		query = query.Where("created_at >= ?", *filter.StartTime)
	}
	if filter.EndTime != nil {
		query = query.Where("created_at <= ?", *filter.EndTime)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count login logs: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	var rows []models.LoginLog
	if err := query.Order("created_at DESC, id DESC").
		Offset((page - 1) * pageSize).Limit(pageSize).
		Find(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list login logs: %w", err)
	}
	out := make([]*domain.LoginLog, 0, len(rows))
	for i := range rows {
		out = append(out, &domain.LoginLog{
			ID:        rows[i].ID,
			Username:  rows[i].Username,
			Success:   rows[i].Success,
			IP:        rows[i].IP,
			CreatedAt: rows[i].CreatedAt,
		})
	}
	return out, total, nil
}
