package networkdomain

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CascadeRetireResult 级联清退结果
type CascadeRetireResult struct {
	AgentCount    int64 `json:"agent_count"`
	TokenRevoked  bool  `json:"token_revoked"`
}

// CascadeRetire 执行级联清退（事务性保障）
// 步骤：①废止Token ②停止配置下发 ③EdgeAgent标retired ④软删NetworkDomain
// 任一步失败全部回滚
func CascadeRetire(db *gorm.DB, domainID string) (*CascadeRetireResult, error) {
	result := &CascadeRetireResult{}

	err := db.Transaction(func(tx *gorm.DB) error {
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
		result.AgentCount = agentResult.RowsAffected

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
