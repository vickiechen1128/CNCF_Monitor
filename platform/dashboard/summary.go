// Package dashboard 实现 MVP 首页聚合接口 GET /api/v2/platform/dashboard/summary：
// 一次性聚合监控资源数、已监控资源数、采集 Job 数、待确认配置草稿数、最近下发记录
// 与已纳管网域数，避免前端多次调用。数据访问复用既有 models / GORM 查询模式（参考
// platform/config/resource、platform/configcenter/draft、platform/configcenter/deployment），
// 不重复造轮子。
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

// scrapeJobDraftReady 采集 Job 可生效的 draft_status 取值（models.ScrapeJob.DraftStatus）。
// 与 platform/query/coverage.go 的「未监控 = 未被任何 ready+enabled Job 选中」判定保持同源。
const scrapeJobDraftReady = "ready"

// resourceModels 返回 M07 五类资源表模型（口径与 platform/query、config/resource 一致）。
func resourceModels() []interface{} {
	return []interface{}{
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	}
}

// DeploymentItem 是 recent_deployments 单条下发记录摘要。
type DeploymentItem struct {
	ID                string     `json:"id"`
	ChangeNo          string     `json:"change_no"`
	NetworkDomainName string     `json:"network_domain_name"`
	Status            string     `json:"status"`
	TriggeredAt       *time.Time `json:"triggered_at"`
}

// Summary 是首页聚合接口的返回结构。
type Summary struct {
	ResourceCount         int              `json:"resource_count"`           // 监控资源总数（M07 resource）
	MonitoredCount        int              `json:"monitored_count"`          // 已监控资源数（口径见 §3.5：ready+enabled 标准 Job 覆盖去重）
	ScrapeJobCount        int              `json:"scrape_job_count"`         // 采集 Job 总数（M01，未软删）
	ScrapeJobEnabledCount int              `json:"scrape_job_enabled_count"` // 采集 Job 中 enabled=true 数
	PendingDraftCount     int              `json:"pending_draft_count"`      // 待确认配置草稿数（M09，status=pending）
	RecentDeployments     []DeploymentItem `json:"recent_deployments"`       // 最近下发记录（最多 5 条）
	DomainCount           int              `json:"domain_count"`             // 已纳管网域数（is_monitored=true）
}

// Build 聚合各模块已有数据生成首页统计概览。
// 复用 models 五类资源表 / ScrapeJob / ConfigDraft / ConfigDeployment / NetworkDomain 的
// GORM 查询（Count/Find/Pluck），软删由 GORM 自动排除；错误沿用 fmt.Errorf("...: %w")。
func Build(db *gorm.DB) (*Summary, error) {
	s := &Summary{RecentDeployments: []DeploymentItem{}}

	// 1. resource_count：五类监控资源表行数之和；顺带收集现存 resource_id 集合，
	//    供 monitored_count 求交集（避免资源已软删导致 monitored_count > resource_count）。
	resourceIDs := make(map[string]bool)
	for _, m := range resourceModels() {
		var n int64
		if err := db.Model(m).Count(&n).Error; err != nil {
			return nil, fmt.Errorf("count resource: %w", err)
		}
		s.ResourceCount += int(n)

		var ids []string
		if err := db.Model(m).Pluck("resource_id", &ids).Error; err != nil {
			return nil, fmt.Errorf("list resource ids: %w", err)
		}
		for _, id := range ids {
			if id != "" {
				resourceIDs[id] = true
			}
		}
	}

	// 2. monitored_count：被 ready + enabled 的标准采集 Job 覆盖到的资源数（去重）。
	//    口径见 docs/05-execution-records/module-05/design-proposals/
	//    homepage-mvp-content-restructure.md §3.5；与 platform/query/coverage.go 的
	//    「未监控」补集同源，故 monitored_count ≤ resource_count。
	selected, err := loadSelectedResourceIDs(db)
	if err != nil {
		return nil, err
	}
	for id := range selected {
		if resourceIDs[id] {
			s.MonitoredCount++
		}
	}

	// 3. scrape_job_count / scrape_job_enabled_count：未软删采集 Job 总数与其中启用数。
	var jobCount int64
	if err := db.Model(&models.ScrapeJob{}).Count(&jobCount).Error; err != nil {
		return nil, fmt.Errorf("count scrape jobs: %w", err)
	}
	s.ScrapeJobCount = int(jobCount)

	var enabledJobCount int64
	if err := db.Model(&models.ScrapeJob{}).Where("enabled = ?", true).Count(&enabledJobCount).Error; err != nil {
		return nil, fmt.Errorf("count enabled scrape jobs: %w", err)
	}
	s.ScrapeJobEnabledCount = int(enabledJobCount)

	// 4. pending_draft_count：status=pending 的配置草稿数。
	var pendingDrafts int64
	if err := db.Model(&models.ConfigDraft{}).
		Where("status = ?", models.DraftStatusPending).
		Count(&pendingDrafts).Error; err != nil {
		return nil, fmt.Errorf("count pending config drafts: %w", err)
	}
	s.PendingDraftCount = int(pendingDrafts)

	// 5. recent_deployments：最近 5 条下发记录，LEFT JOIN 网域表取网域名。
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
			ID:                r.DeploymentID,
			ChangeNo:          r.SourceChangeNo,
			NetworkDomainName: r.NetworkDomainName,
			Status:            string(r.Status),
			TriggeredAt:       r.TriggeredAt,
		})
	}

	// 6. domain_count：已纳管网域数（is_monitored=true）。
	var domainCount int64
	if err := db.Model(&models.NetworkDomain{}).
		Where("is_monitored = ?", true).
		Count(&domainCount).Error; err != nil {
		return nil, fmt.Errorf("count monitored network domains: %w", err)
	}
	s.DomainCount = int(domainCount)

	return s, nil
}

// loadSelectedResourceIDs 聚合 job_type=standard 且 ready+enabled 的采集 Job 的
// selected_instance_ids 并集（去重，元素为 M07 resource_id）。
//
// 仅统计 standard Job：blackbox 拨测目标的 resource_id 落在 blackbox_targets 内、
// 不属 M07 资源（models.BlackboxTarget），故不计入「已监控」。
// 判定条件与 platform/query/coverage.go 的 loadSelectedInstances 一致，读侧只消费
// M01 选中关系、不反向修改 M01。
func loadSelectedResourceIDs(db *gorm.DB) (map[string]bool, error) {
	selected := make(map[string]bool)

	var jobs []models.ScrapeJob
	if err := db.Model(&models.ScrapeJob{}).
		Select("selected_instance_ids").
		Where("job_type = ? AND draft_status = ? AND enabled = ?",
			models.JobTypeStandard, scrapeJobDraftReady, true).
		Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("list enabled scrape jobs: %w", err)
	}
	for _, j := range jobs {
		for _, id := range j.SelectedInstanceIDs {
			if id != "" {
				selected[id] = true
			}
		}
	}
	return selected, nil
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
