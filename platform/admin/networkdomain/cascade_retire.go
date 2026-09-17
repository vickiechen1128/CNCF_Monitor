package networkdomain

import (
	"fmt"
	"strconv"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// WillRetireAgent 待退场 Agent 明细（id/hostname/当前 status）
type WillRetireAgent struct {
	ID       string `json:"id"`
	Hostname string `json:"hostname"`
	Status   string `json:"status"` // 退役前的当前状态（online/unknown/offline）
}

// CascadeRetireResult 级联清退结果
type CascadeRetireResult struct {
	AgentCount       int64             `json:"agent_count"`
	WillRetireAgents []WillRetireAgent `json:"will_retire_agents"` // 实际将被 retire 的 Agent 明细，与 AgentCount 口径一致
	TokenRevoked     bool              `json:"token_revoked"`
}

// CascadeRetire 执行级联清退（事务性保障）
// 步骤：①废止Token ②停止配置下发 ③EdgeAgent标retired ④软删NetworkDomain
// 任一步失败全部回滚。
// 清退范围：该网域下 status∈(online, unknown, offline) 的 EdgeAgent 统一标 retired（offline 也一并退场），
// 返回的 WillRetireAgents 即为实际退役清单（id/hostname/当前 status）。
func CascadeRetire(db *gorm.DB, domainID string) (*CascadeRetireResult, error) {
	// 空切片（而非 nil）确保无 Agent 时 will_retire_agents 序列化为 [] 而非 null。
	result := &CascadeRetireResult{WillRetireAgents: []WillRetireAgent{}}

	err := db.Transaction(func(tx *gorm.DB) error {
		// 步骤0：先读取将被退役的 Agent 明细（退役前状态），确保响应名单与实际退役口径一致（决策 82-1/MEDIUM-4）。
		var agents []models.EdgeAgent
		if err := tx.Where("network_domain_id = ?", domainID).
			Where("status IN ?", []string{models.EdgeAgentStatusOnline, models.EdgeAgentStatusUnknown, models.EdgeAgentStatusOffline}).
			Find(&agents).Error; err != nil {
			return fmt.Errorf("find edge agents to retire: %w", err)
		}
		for _, a := range agents {
			result.WillRetireAgents = append(result.WillRetireAgents, WillRetireAgent{
				ID:       strconv.FormatUint(uint64(a.ID), 10),
				Hostname: a.Hostname,
				Status:   a.Status,
			})
		}
		result.AgentCount = int64(len(agents))

		// 状态机防御性校验：逐个确认可迁往 retired（终态不可逆）。
		// 当前查询已限定非 retired 集合，此处作为对查询条件未来回归的护栏。
		for _, a := range agents {
			if err := models.CanTransitionToEdgeAgentStatus(a.Status, models.EdgeAgentStatusRetired); err != nil {
				return fmt.Errorf("edge agent %d (%s) cannot be retired: %w", a.ID, a.Status, err)
			}
		}

		// 步骤①：废止Token（置空）
		if err := tx.Model(&models.NetworkDomain{}).
			Where("id = ?", domainID).
			Update("token", "").Error; err != nil {
			return fmt.Errorf("revoke token: %w", err)
		}
		result.TokenRevoked = true

		// 步骤②：停止配置下发（MVP阶段无ConfigDeployment模型，预留接口）
		// TODO: v0.2+ 实现 ConfigDeployment 标记 stopped/revoked

		// 步骤③：EdgeAgent标retired（终态）
		agentResult := tx.Model(&models.EdgeAgent{}).
			Where("network_domain_id = ?", domainID).
			Where("status IN ?", []string{models.EdgeAgentStatusOnline, models.EdgeAgentStatusUnknown, models.EdgeAgentStatusOffline}).
			Update("status", models.EdgeAgentStatusRetired)
		if agentResult.Error != nil {
			return fmt.Errorf("retire edge agents: %w", agentResult.Error)
		}

		// 步骤④：软删NetworkDomain
		if err := tx.Where("id = ?", domainID).Delete(&models.NetworkDomain{}).Error; err != nil {
			return fmt.Errorf("soft delete network domain: %w", err)
		}

		return nil
	})

	if err != nil {
		return nil, err
	}

	return result, nil
}
