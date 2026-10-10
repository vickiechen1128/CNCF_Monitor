// references.go 提供资源「被哪些采集 Job 引用」的只读查询接口
// GET /api/v2/platform/resources/:resource_id/referenced-by（Module_07 §6.6.1，B 方案
// 知情确认，决策记录见 docs/05-execution-records/module-07/dev-feedback.md §15 F-21）。
//
// 设计动机：删除资源（软删）的引用保护，原 PRD §6.6.1 写为「被 ScrapeJob 引用时 403
// 拦截 + 回传引用 Job 名单」，但 M01 从未实现该 403（delete.go 的 TODO(M01) 长期静默
// 放行）。经决策采用 B 方案：删除仍静默放行（软删可恢复），引用信息改由本只读接口在
// 删除二次确认弹窗中预检回显（「该资源正被 N 个采集 Job 引用」+「查看引用 Job」跳转），
// 与生成侧 offline 静默排除（generator/targets.go:282 SkipReasonOffline）口径一致。
package resource

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ResourceReferenceJob 是单个引用该资源的采集 Job 视图（PRD §6.6.1 引用 Job 名单口径）：
// {job_name, network_domain_id, enabled}。
type ResourceReferenceJob struct {
	JobName         string `json:"job_name"`          // 采集 Job 名（§6.6.1 引用名单 job_name）
	NetworkDomainID string `json:"network_domain_id"` // 所属网域（§6.6.1 引用名单 network_domain_id）
	Enabled         bool   `json:"enabled"`           // 是否启用（停用仍计入引用，见下）
}

// ListResourceReferences 是 GET /api/v2/platform/resources/:resource_id/referenced-by 的
// handler：返回引用该资源的全部采集 Job 名单（§6.6.1 引用 Job 名单口径）。响应 data：
// {jobs: [{job_name, network_domain_id, enabled}], total}。
//
// 判定口径（与 M07 标签模板引用保护 §6.6.3.1 一字不差）：
//   - 资源不存在/已软删 → not_found（与删除接口同源 findResourceByID，GORM 默认排除软删）；
//   - 停用 Job（enabled=false）同样计入引用——其 target 配置仍留在已下发的 prometheus.yml
//     中未回收，删资源会让「恢复启用」在无感知下换掉采集实例；
//   - 软删 Job（deleted_at 非空）不计——GORM 软删自动过滤。
//
// 由于 selected_instance_ids 是 JSON serializer 列，无法用标量 WHERE 精确判定包含关系，
// 故加载全部未软删 ScrapeJob 后在 Go 侧按 SelectedInstanceIDs 成员判定（MVP 规模可接受，
// 与 strategy/scrapejob/installation.go 同类扫描同口径）。
func ListResourceReferences(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}

		// 资源不存在/已软删 → not_found（与删除接口同源，避免对孤儿资源做无意义反查）。
		if _, _, found, err := findResourceByID(db, resourceID); err != nil {
			response.InternalServerError(c, err)
			return
		} else if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}

		// GORM 软删自动过滤已删 Job；JSON serializer 列在扫描后于内存判定成员。
		var jobs []models.ScrapeJob
		if err := db.Find(&jobs).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("查询引用 %s 的采集 Job: %w", resourceID, err))
			return
		}

		refs := make([]ResourceReferenceJob, 0, len(jobs))
		for _, j := range jobs {
			if containsInstance(j.SelectedInstanceIDs, resourceID) {
				refs = append(refs, ResourceReferenceJob{
					JobName:         j.JobName,
					NetworkDomainID: j.NetworkDomainID,
					Enabled:         j.Enabled,
				})
			}
		}
		response.OK(c, gin.H{"jobs": refs, "total": len(refs)})
	}
}

// containsInstance 判定 target 是否在 ids 列表中（精确匹配，避免子串误判）。
func containsInstance(ids []string, target string) bool {
	for _, id := range ids {
		if id == target {
			return true
		}
	}
	return false
}
