package networkdomain

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// seedImpactDomain 插入一个边缘网域，并注册若干不同状态的 EdgeAgent 与 M07 资源，
// 供 ComputeImpact 语义断言使用。
func seedImpactDomain(t *testing.T, db *gorm.DB, agents []*models.EdgeAgent) string {
	t.Helper()
	domainID := "mc-impact"
	insertDomain(t, db, &models.NetworkDomain{
		ID: domainID, Name: "影响域", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	for _, a := range agents {
		a.NetworkDomainID = domainID
		if a.AgentType == "" {
			a.AgentType = models.AgentTypeVMAgent
		}
		require.NoError(t, db.Create(a).Error)
	}
	require.NoError(t, db.Create(&models.Host{
		ResourceCategory: models.ResourceCategoryHost, NetworkDomainID: domainID, BizCode: "b",
		InstanceName: "h1", Status: "running", Region: "r", ZoneEnv: "z", InstanceSpec: "s", Image: "img",
		VPC: "v", SecurityGroup: "sg",
	}).Error)
	return domainID
}

// TestComputeImpact_HasOnlineAgents 决策 82-2：unknown 不计为在线，仅 status=online 存在时
// has_online_agents=true；managed_edge_agent_count 仍统计 online/unknown。
func TestComputeImpact_HasOnlineAgents(t *testing.T) {
	db := openTestDB(t)
	domainID := seedImpactDomain(t, db, []*models.EdgeAgent{
		{Status: models.EdgeAgentStatusOnline, Hostname: "h-online"},
		{Status: models.EdgeAgentStatusUnknown, Hostname: "h-unknown"},
		{Status: models.EdgeAgentStatusOffline, Hostname: "h-offline"},
	})

	impact, err := ComputeImpact(db, domainID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), impact.ResourceCount)
	assert.Equal(t, int64(2), impact.ManagedEdgeAgentCount, "已纳管数含 online/unknown")
	assert.True(t, impact.HasOnlineAgents, "存在 online Agent 时应为 true")
}

// TestComputeImpact_NoOnlineAgent 决策 82-2：仅 unknown（无 online）时 has_online_agents 应为 false。
func TestComputeImpact_NoOnlineAgent(t *testing.T) {
	db := openTestDB(t)
	domainID := seedImpactDomain(t, db, []*models.EdgeAgent{
		{Status: models.EdgeAgentStatusUnknown, Hostname: "h-unknown"},
		{Status: models.EdgeAgentStatusOffline, Hostname: "h-offline"},
	})

	impact, err := ComputeImpact(db, domainID)
	require.NoError(t, err)
	assert.Equal(t, int64(1), impact.ResourceCount)
	assert.Equal(t, int64(1), impact.ManagedEdgeAgentCount, "unknown 计入已纳管数")
	assert.False(t, impact.HasOnlineAgents, "无 online 时 unknown 不应误判为在线")
}

// TestComputeImpact_RetiredNotCounted retired 终态不计入已纳管与在线。
func TestComputeImpact_RetiredNotCounted(t *testing.T) {
	db := openTestDB(t)
	domainID := seedImpactDomain(t, db, []*models.EdgeAgent{
		{Status: models.EdgeAgentStatusRetired, Hostname: "h-retired"},
	})

	impact, err := ComputeImpact(db, domainID)
	require.NoError(t, err)
	assert.Equal(t, int64(0), impact.ManagedEdgeAgentCount, "retired 不计入已纳管")
	assert.False(t, impact.HasOnlineAgents)
}

// TestComputeImpact_EmptyDomain 空网域：影响范围全零。
func TestComputeImpact_EmptyDomain(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-impact-empty", Name: "空载影响域", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})

	impact, err := ComputeImpact(db, "mc-impact-empty")
	require.NoError(t, err)
	assert.Equal(t, int64(0), impact.ResourceCount)
	assert.Equal(t, int64(0), impact.ManagedEdgeAgentCount)
	assert.False(t, impact.HasOnlineAgents)
}