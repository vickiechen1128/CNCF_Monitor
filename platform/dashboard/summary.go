// Package dashboard 实现 MVP 首页聚合接口 GET /api/v2/platform/dashboard/summary：
// 一次性聚合监控资源数、待确认配置草稿数、最近下发记录与已纳管网域数，避免前端
// 多次调用。数据访问复用既有 models / GORM 查询模式（参考 platform/config/resource、
// platform/configcenter/draft、platform/configcenter/deployment），不重复造轮子。
package dashboard

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// recentDeploymentLimit 最近下发记录条数上限。
const recentDeploymentLimit = 5

// DeploymentItem 是 recent_deployments 单条下发记录摘要。
type DeploymentItem struct {
	ID                uint       `json:"id"`
	ChangeNo          string     `json:"change_no"`
	NetworkDomainName string     `json:"network_domain_name"`
	Status            string     `json:"status"`
	TriggeredAt       *time.Time `json:"triggered_at"`
}

// Summary 是首页聚合接口的返回结构。
type Summary struct {
	ResourceCount     int              `json:"resource_count"`       // 监控资源总数（M07 resource）
	PendingDraftCount int              `json:"pending_draft_count"`  // 待确认配置草稿数（M09，status=pending）
	RecentDeployments []DeploymentItem `json:"recent_deployments"`   // 最近下发记录（最多 5 条）
	DomainCount       int              `json:"domain_count"`         // 已纳管网域数（is_monitored=true）
}

// Build 聚合各模块已有数据生成首页统计概览。
// 复用 models 五类资源表 / ConfigDraft / ConfigDeployment / NetworkDomain 的
// GORM 查询（Count/Find），软删由 GORM 自动排除；错误沿用 fmt.Errorf("...: %w")。
func Build(db *gorm.DB) (*Summary, error) {
	s := &Summary{RecentDeployments: []DeploymentItem{}}

	// 1. resource_count：五类监控资源表行数之和。
	for _, m := range []interface{}{
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	} {
		var n int64
		if err := db.Model(m).Count(&n).Error; err != nil {
			return nil, fmt.Errorf("count resource: %w", err)
		}
		s.ResourceCount += int(n)
	}

	// 2. pending_draft_count：status=pending 的配置草稿数。
	var pendingDrafts int64
	if err := db.Model(&models.ConfigDraft{}).
		Where("status = ?", models.DraftStatusPending).
		Count(&pendingDrafts).Error; err != nil {
		return nil, fmt.Errorf("count pending config drafts: %w", err)
	}
	s.PendingDraftCount = int(pendingDrafts)

	// 3. recent_deployments：最近 5 条下发记录，LEFT JOIN 网域表取网域名。
	var rows []struct {
		models.ConfigDeployment
		NetworkDomainName string `gorm:"column:network_domain_name"`
	}
	if err := db.Model(&models.ConfigDeployment{}).
		Select("config_deployments.*, network_domains.name AS network_domain_name").
		Joins("LEFT JOIN network_domains ON network_domains.id = config_deployments.network_domain_id").
		Order("config_deployments.created_at DESC").
		Limit(recentDeploymentLimit).
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list recent deployments: %w", err)
	}
	for _, r := range rows {
		s.RecentDeployments = append(s.RecentDeployments, DeploymentItem{
			ID:                r.ID,
			ChangeNo:          r.SourceChangeNo,
			NetworkDomainName: r.NetworkDomainName,
			Status:            string(r.Status),
			TriggeredAt:       r.TriggeredAt,
		})
	}

	// 4. domain_count：已纳管网域数（is_monitored=true）。
	var domainCount int64
	if err := db.Model(&models.NetworkDomain{}).
		Where("is_monitored = ?", true).
		Count(&domainCount).Error; err != nil {
		return nil, fmt.Errorf("count monitored network domains: %w", err)
	}
	s.DomainCount = int(domainCount)

	return s, nil
}

// SummaryHandler 处理 GET /api/v2/platform/dashboard/summary。
func SummaryHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		s, err := Build(db)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, s)
	}
}