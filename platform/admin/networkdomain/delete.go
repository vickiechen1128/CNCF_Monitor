package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteNetworkDomain soft-deletes a network domain.
// 决策 82-1：M07 资源引用拒绝删除；已纳管 EdgeAgent 不再拒绝，改级联清退。
// 删除前置校验还包括采集 Job 引用与待确认配置变更单：两者都会在删除后悬空
// （Job 无法再生成配置、pending 草稿确认时找不到网域），必须由用户先处理。
// 中心直连域不再是系统预置不可删：与采集节点域同一套删除/重建生命周期。
func DeleteNetworkDomain(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var dom models.NetworkDomain
		if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("network domain %q not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get network domain %q: %w", id, err))
			return
		}

		// 删除前置校验（未软删的引用均计入）：
		//   1) M07 资源引用（决策 82-1）
		//   2) 采集 Job 引用——含已停用 Job；Job 会随配置生成继续存在
		//   3) 待确认配置变更单——删除后无法确认，会永久卡 pending
		resourceCount, err := countResources(db, id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if resourceCount > 0 {
			response.Forbidden(c, fmt.Sprintf("network domain %q still has %d M07 resource reference(s); please remove them first", id, resourceCount))
			return
		}

		var jobCount int64
		if err := db.Model(&models.ScrapeJob{}).Where("network_domain_id = ?", id).Count(&jobCount).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count scrape jobs for domain %q: %w", id, err))
			return
		}
		if jobCount > 0 {
			response.Forbidden(c, fmt.Sprintf("network domain %q still has %d scrape job reference(s); please delete them first", id, jobCount))
			return
		}

		var pendingDraftCount int64
		if err := db.Model(&models.ConfigDraft{}).
			Where("network_domain_id = ? AND status = ?", id, models.DraftStatusPending).
			Count(&pendingDraftCount).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count pending config drafts for domain %q: %w", id, err))
			return
		}
		if pendingDraftCount > 0 {
			response.Forbidden(c, fmt.Sprintf("network domain %q still has %d pending config draft(s); please discard them first", id, pendingDraftCount))
			return
		}

		// 执行级联清退（决策 82-1：废止Token + EdgeAgent标retired + 软删网域，offline 一并退场）
		retireResult, err := CascadeRetire(db, id)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("cascade retire network domain %q: %w", id, err))
			return
		}

		// 返回级联影响清单（契约 §5.1.2）：edge_agent_count 与实际退役名单口径一致
		response.OK(c, gin.H{
			"id": id,
			"cascade_impact": gin.H{
				"edge_agent_count":   retireResult.AgentCount,
				"will_retire_agents": retireResult.WillRetireAgents,
			},
		})
	}
}
