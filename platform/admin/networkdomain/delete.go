package networkdomain

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteNetworkDomain soft-deletes a network domain.
// 决策 82-1：硬拒绝收敛为「存在 M07 资源引用」单一条件；已纳管 EdgeAgent 不再拒绝，改级联清退。
// Management domains cannot be deleted.
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

		if dom.IsManagement() {
			response.BadRequest(c, fmt.Errorf("management domain %q cannot be deleted", id))
			return
		}

		// 决策 82-1：仅当有 M07 资源引用时拒绝（返回 forbidden + 引用名单）
		resourceCount, err := countResources(db, id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if resourceCount > 0 {
			response.Forbidden(c, fmt.Sprintf("network domain %q still has %d M07 resource reference(s); please remove them first", id, resourceCount))
			return
		}

		// 查询已纳管 EdgeAgent（不再拒绝，改级联清退）
		managedAgentCount, err := countManagedEdgeAgents(db, id)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		// 构建级联影响清单（预清退）
		cascadeImpact := gin.H{
			"managed_edge_agent_count": managedAgentCount,
			"token_will_revoke":        managedAgentCount > 0,
			"config_push_will_stop":    managedAgentCount > 0,
			"agents_will_retire":       managedAgentCount,
		}

		// 执行级联清退（决策 82-1：废止Token + EdgeAgent标retired + 软删网域）
		retireResult, err := CascadeRetire(db, id)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("cascade retire network domain %q: %w", id, err))
			return
		}

		// 返回级联清退结果
		response.OK(c, gin.H{
			"id":             id,
			"deleted":        true,
			"cascade_impact": cascadeImpact,
			"cascade_retired": gin.H{
				"agent_count":    retireResult.AgentCount,
				"token_revoked":  retireResult.TokenRevoked,
			},
		})
	}
}
