package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// channelOf loads the persisted channel of a network domain.
func channelOf(t *testing.T, db *gorm.DB, id string) models.ChannelType {
	t.Helper()
	var dom models.NetworkDomain
	require.NoError(t, db.Where("id = ?", id).First(&dom).Error)
	return dom.Channel
}

// TestRunBackfillsDomainChannelFromDomainType 覆盖 F-28 方案 A 的存量对齐：
// 登记接口早期无条件把新网域写成 channel=local，未纳管边缘域因此在列表 / 详情 /
// 纳管抽屉被误判为 local（连带不弹 Token 复制弹窗）。Run 需按 domain_type 回填。
func TestRunBackfillsDomainChannelFromDomainType(t *testing.T) {
	db := newTestDB(t)

	// 存量脏数据：边缘域却是 local 通道。
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "mc-a6854eab", Name: "test-a", DomainType: models.DomainTypeEdge,
		Channel: models.ChannelTypeLocal, TenantID: models.PlatformAdminTenantID,
		Status: models.DomainStatusEnabled,
	}).Error)
	// 已对齐的记录：回填不应改动（幂等）。
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "mc-edge-ok", Name: "edge-ok", DomainType: models.DomainTypeEdge,
		Channel: models.ChannelTypeAgentPull, TenantID: models.PlatformAdminTenantID,
		Status: models.DomainStatusEnabled,
	}).Error)

	require.NoError(t, Run(db))
	assert.Equal(t, models.ChannelTypeAgentPull, channelOf(t, db, "mc-a6854eab"), "边缘域应回填为 agent_pull")
	assert.Equal(t, models.ChannelTypeAgentPull, channelOf(t, db, "mc-edge-ok"), "已对齐记录保持 agent_pull")
	assert.Equal(t, models.ChannelTypeLocal, channelOf(t, db, models.DefaultDomainID), "管理域保持 local")

	// 幂等：重复 Run 不改变结果。
	require.NoError(t, Run(db))
	assert.Equal(t, models.ChannelTypeAgentPull, channelOf(t, db, "mc-a6854eab"))
}

// TestRunBackfillsManagementChannel 覆盖反向对齐：管理域若被写成 agent_pull
// （例如经错误的登记路径），Run 需纠正回 local。
func TestRunBackfillsManagementChannel(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "mgmt-ops", Name: "运维管理域", DomainType: models.DomainTypeManagement,
		Channel: models.ChannelTypeAgentPull, TenantID: models.PlatformAdminTenantID,
		Status: models.DomainStatusEnabled,
	}).Error)

	require.NoError(t, Run(db))
	assert.Equal(t, models.ChannelTypeLocal, channelOf(t, db, "mgmt-ops"), "管理域应回填为 local")
}

// TestRunLeavesDomainTypeUnsetRowsUntouched 保证回填只按 domain_type 精确命中，
// 不误改 domain_type 为空的历史测试 / 兼容记录。
func TestRunLeavesDomainTypeUnsetRowsUntouched(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "legacy", Name: "历史记录", Channel: models.ChannelTypeLocal,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled,
	}).Error)

	require.NoError(t, Run(db))
	assert.Equal(t, models.ChannelTypeLocal, channelOf(t, db, "legacy"), "domain_type 为空的记录不被回填")
}