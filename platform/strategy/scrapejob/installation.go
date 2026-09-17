package scrapejob

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// jobInstanceItem 是 Job 实例列表项：已选实例 + 资源实例名/IP + 安装状态
// （unconfirmed/confirmed）。instance_name/instance_ip 由 resolveResourceMeta 按
// resource_id 从资源表解析（原型对齐：详情展示实例名称与 IP）。
type jobInstanceItem struct {
	ResourceID   string `json:"resource_id"`
	InstanceName string `json:"instance_name"`
	InstanceIP   string `json:"instance_ip"`
	// 未找到该实例的确认记录时 status 为 unconfirmed（默认）。
	Status string `json:"status"`
}

// resolveResourceMeta 按 resource_id 跨五类资源表定位实例展示名与 IP。口径对齐
// instance-candidates：host=InstanceName/PrivateIP，database=ResourceID/InstanceIP，
// middleware=AppName/InstanceIP，application=ServiceName/HealthCheckURL，
// generic_target=TargetName/InstanceIP。未命中返回空串。
func resolveResourceMeta(db *gorm.DB, resourceID string) (name, ip string, found bool) {
	lookups := []struct {
		dest    any
		getMeta func(any) (string, string)
	}{
		{&models.Host{}, func(m any) (string, string) {
			r := m.(*models.Host)
			return r.InstanceName, r.PrivateIP
		}},
		{&models.Database{}, func(m any) (string, string) {
			r := m.(*models.Database)
			return r.GetResourceID(), r.InstanceIP
		}},
		{&models.Middleware{}, func(m any) (string, string) {
			r := m.(*models.Middleware)
			return r.AppName, r.InstanceIP
		}},
		{&models.Application{}, func(m any) (string, string) {
			r := m.(*models.Application)
			return r.ServiceName, r.HealthCheckURL
		}},
		{&models.GenericTarget{}, func(m any) (string, string) {
			r := m.(*models.GenericTarget)
			return r.TargetName, r.InstanceIP
		}},
	}
	for _, l := range lookups {
		if err := db.Where("resource_id = ?", resourceID).First(l.dest).Error; err == nil {
			n, i := l.getMeta(l.dest)
			return n, i, true
		}
	}
	return "", "", false
}

// ListJobInstances 是 GET /api/v2/platform/scrape-jobs/:id/instances 的 handler：
// 返回该 Job 已选实例 + 安装状态。Job 未命中 not_found（api-contract-snapshot §6）。
func ListJobInstances(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var job models.ScrapeJob
		if err := db.First(&job, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("scrape job %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get scrape job %d: %w", id, err))
			return
		}

		// 查询该 Job 的安装确认记录映射（resource_id → status）。
		var confs []models.ExporterInstallationConfirmation
		if err := db.Where("scrape_job_id = ?", id).Find(&confs).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list installation confirmations: %w", err))
			return
		}
		statusByResource := make(map[string]string, len(confs))
		for _, cnf := range confs {
			statusByResource[cnf.ResourceID] = string(cnf.Status)
		}

		items := make([]jobInstanceItem, 0, len(job.SelectedInstanceIDs))
		for _, rid := range job.SelectedInstanceIDs {
			st, ok := statusByResource[rid]
			if !ok {
				st = string(models.InstallationStatusUnconfirmed)
			}
			name, ip, _ := resolveResourceMeta(db, rid)
			items = append(items, jobInstanceItem{ResourceID: rid, InstanceName: name, InstanceIP: ip, Status: st})
		}
		response.OK(c, gin.H{"items": items, "total": len(items)})
	}
}

// confirmRequest 是安装确认的请求体。confirmed_by 不再接受客户端传参（review-fix C）：
// 由 handler 从认证上下文当前用户派生，字段保留仅为兼容旧客户端传参（被忽略）。
// 决策 47-1：confirmation 已降级为「可选登记 / 人工背书」，非生成闸门、不阻断 target。
type confirmRequest struct {
	ConfirmedBy string `json:"confirmed_by"`
	ActualPort  int    `json:"actual_port"`
	Notes       string `json:"notes"`
}

// ConfirmInstallation 是 POST /api/v2/platform/scrape-jobs/:id/instances/:resource_id/
// confirm 的 handler：可选登记该资源已安装 Exporter，落 ExporterInstallationConfirmation
// （status=confirmed）。决策 47-1：本登记为「可选登记 / 人工背书」，**非生成闸门、不阻断
// target 生成**——configgen 仍按 selected_instance_ids 生成 target（见 generator.ResolveJobTargets），
// 是否登记不影响 target 组。校验资源在 Job selected_instance_ids 且同域（bad_request）；
// Job 未命中 not_found（api-contract-snapshot §6）。商品语义与交互（端口一致性提示等）不变。
func ConfirmInstallation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		resourceID := c.Param("resource_id")
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}
		var req confirmRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid confirmation payload: %w", err))
			return
		}
		// review-fix C：confirmed_by 取自动态认证上下文当前用户，不信任客户端传参（伪鉴权）。
		// 取不到当前用户（理论上鉴权中间件保证恒有）时回落 "unknown" 并记日志兜底。
		confirmedBy := auth.CurrentUsername(c)
		if auth.CurrentUser(c) == nil {
			log.Printf("[scrapejob] confirm installation: 认证上下文无当前用户，confirmed_by 回落 unknown")
		}

		var job models.ScrapeJob
		if err := db.First(&job, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("scrape job %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get scrape job %d: %w", id, err))
			return
		}

		// 资源须在选中集。
		inSet := false
		for _, rid := range job.SelectedInstanceIDs {
			if rid == resourceID {
				inSet = true
				break
			}
		}
		if !inSet {
			response.BadRequest(c, fmt.Errorf("实例 %q 不在该采集 Job 的已选实例集中", resourceID))
			return
		}
		// 资源须与 Job 同域。
		okDomain, err := resourceInDomain(db, resourceID, job.NetworkDomainID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !okDomain {
			response.BadRequest(c, fmt.Errorf("实例 %q 不属于网域 %q", resourceID, job.NetworkDomainID))
			return
		}

		now := time.Now()
		conf := &models.ExporterInstallationConfirmation{
			ResourceID:         resourceID,
			ScrapeJobID:        id,
			ExporterTemplateID: job.ExporterTemplateID,
			Status:             models.InstallationStatusConfirmed,
			ConfirmedBy:        confirmedBy,
			ConfirmedAt:        &now,
			Notes:              req.Notes,
			ActualPort:         req.ActualPort,
		}
		// PK=(resource_id, scrape_job_id)：upsert（重复确认幂等更新）。
		if err := db.Save(conf).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("save installation confirmation: %w", err))
			return
		}
		response.OK(c, conf)
	}
}

// CancelInstallation 是 DELETE /api/v2/platform/scrape-jobs/:id/instances/:resource_id/
// confirm 的 handler：删除安装确认登记记录。返回 `{resource_id, job_id}`；未命中 not_found
// （api-contract-snapshot §6）。决策 47-1：删除确认记录不影响 target 组，仅清空登记。
func CancelInstallation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		resourceID := c.Param("resource_id")
		del := db.Where("resource_id = ? AND scrape_job_id = ?", resourceID, id).
			Delete(&models.ExporterInstallationConfirmation{})
		if del.Error == gorm.ErrRecordNotFound {
			response.NotFound(c, fmt.Sprintf("installation confirmation %s/%d not found", resourceID, id))
			return
		}
		if del.Error != nil {
			response.InternalServerError(c, fmt.Errorf("delete installation confirmation: %w", del.Error))
			return
		}
		if del.RowsAffected == 0 {
			response.NotFound(c, fmt.Sprintf("installation confirmation %s/%d not found", resourceID, id))
			return
		}
		response.OK(c, gin.H{"resource_id": resourceID, "job_id": id})
	}
}