package networkdomain

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)

	// 迁移所有需要的模型
	require.NoError(t, db.AutoMigrate(
		&models.NetworkDomain{},
		&models.EdgeAgent{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	))

	return db
}

func TestCascadeRetire_Success(t *testing.T) {
	db := setupTestDB(t)

	// 准备测试数据：创建一个已纳管网域和对应的 EdgeAgent
	domain := &models.NetworkDomain{
		ID:                 "test-domain-001",
		Name:               "测试网域",
		DomainType:         models.DomainTypeEdge,
		TenantID:           "platform_admin",
		AuthorizedTenantIDs: []string{"platform_admin"},
		Status:             models.DomainStatusEnabled,
		Token:              "test-token-123",
	}
	require.NoError(t, db.Create(domain).Error)

	agent := &models.EdgeAgent{
		NetworkDomainID: domain.ID,
		Status:          models.EdgeAgentStatusOnline,
		Hostname:        "test-host",
	}
	require.NoError(t, db.Create(agent).Error)

	// 执行级联清退
	result, err := CascadeRetire(db, domain.ID)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, int64(1), result.AgentCount)
	assert.True(t, result.TokenRevoked)

	// 验证：网域已软删除
	var deletedDomain models.NetworkDomain
	err = db.Where("id = ?", domain.ID).First(&deletedDomain).Error
	assert.Error(t, err) // 应该找不到（软删除）
	assert.Contains(t, err.Error(), "record not found")

	// 验证：EdgeAgent 状态已改为 retired
	var retiredAgent models.EdgeAgent
	require.NoError(t, db.Where("id = ?", agent.ID).First(&retiredAgent).Error)
	assert.Equal(t, models.EdgeAgentStatusRetired, retiredAgent.Status)

	// 验证：Token 已清空
	var domainWithToken models.NetworkDomain
	require.NoError(t, db.Unscoped().Where("id = ?", domain.ID).First(&domainWithToken).Error)
	assert.Equal(t, "", domainWithToken.Token)
}

func TestCascadeRetire_NoAgents(t *testing.T) {
	db := setupTestDB(t)

	// 准备测试数据：创建一个未纳管的空网域
	domain := &models.NetworkDomain{
		ID:                 "test-domain-002",
		Name:               "空网域",
		DomainType:         models.DomainTypeEdge,
		TenantID:           "platform_admin",
		AuthorizedTenantIDs: []string{"platform_admin"},
		Status:             models.DomainStatusEnabled,
		Token:              "",
	}
	require.NoError(t, db.Create(domain).Error)

	// 执行级联清退
	result, err := CascadeRetire(db, domain.ID)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, int64(0), result.AgentCount)
	assert.True(t, result.TokenRevoked)

	// 验证：网域已软删除
	var deletedDomain models.NetworkDomain
	err = db.Where("id = ?", domain.ID).First(&deletedDomain).Error
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "record not found")
}

func TestCascadeRetire_MultipleAgents(t *testing.T) {
	db := setupTestDB(t)

	// 准备测试数据：创建一个网域和多个 EdgeAgent
	domain := &models.NetworkDomain{
		ID:                 "test-domain-003",
		Name:               "多节点网域",
		DomainType:         models.DomainTypeEdge,
		TenantID:           "platform_admin",
		AuthorizedTenantIDs: []string{"platform_admin"},
		Status:             models.DomainStatusEnabled,
		Token:              "test-token-456",
	}
	require.NoError(t, db.Create(domain).Error)

	agents := []*models.EdgeAgent{
		{NetworkDomainID: domain.ID, Status: models.EdgeAgentStatusOnline, Hostname: "host-1"},
		{NetworkDomainID: domain.ID, Status: models.EdgeAgentStatusOffline, Hostname: "host-2"},
		{NetworkDomainID: domain.ID, Status: models.EdgeAgentStatusUnknown, Hostname: "host-3"},
	}
	for _, agent := range agents {
		require.NoError(t, db.Create(agent).Error)
	}

	// 执行级联清退
	result, err := CascadeRetire(db, domain.ID)
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, int64(3), result.AgentCount)
	assert.True(t, result.TokenRevoked)

	// 验证：所有 EdgeAgent 状态已改为 retired
	var retiredAgents []models.EdgeAgent
	require.NoError(t, db.Where("network_domain_id = ?", domain.ID).Find(&retiredAgents).Error)
	assert.Len(t, retiredAgents, 3)
	for _, agent := range retiredAgents {
		assert.Equal(t, models.EdgeAgentStatusRetired, agent.Status)
	}
}

func TestCascadeRetire_DomainNotFound(t *testing.T) {
	db := setupTestDB(t)

	// 执行级联清退（网域不存在）
	result, err := CascadeRetire(db, "non-existent-domain")
	// 事务应该成功（没有数据需要处理）
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, int64(0), result.AgentCount)
	assert.True(t, result.TokenRevoked)
}

func TestCascadeRetire_RetiredStatusIsTerminal(t *testing.T) {
	db := setupTestDB(t)

	// 准备测试数据：创建一个已 retired 的 EdgeAgent
	domain := &models.NetworkDomain{
		ID:                 "test-domain-004",
		Name:               "已退场网域",
		DomainType:         models.DomainTypeEdge,
		TenantID:           "platform_admin",
		AuthorizedTenantIDs: []string{"platform_admin"},
		Status:             models.DomainStatusEnabled,
	}
	require.NoError(t, db.Create(domain).Error)

	agent := &models.EdgeAgent{
		NetworkDomainID: domain.ID,
		Status:          models.EdgeAgentStatusRetired,
		Hostname:        "retired-host",
	}
	require.NoError(t, db.Create(agent).Error)

	// 执行级联清退
	result, err := CascadeRetire(db, domain.ID)
	require.NoError(t, err)
	assert.NotNil(t, result)
	// 已 retired 的 Agent 不应被重复计数
	assert.Equal(t, int64(0), result.AgentCount)

	// 验证：EdgeAgent 状态仍为 retired
	var retiredAgent models.EdgeAgent
	require.NoError(t, db.Where("id = ?", agent.ID).First(&retiredAgent).Error)
	assert.Equal(t, models.EdgeAgentStatusRetired, retiredAgent.Status)
}
