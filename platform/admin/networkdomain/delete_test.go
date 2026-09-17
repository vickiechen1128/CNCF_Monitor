package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
	"github.com/stretchr/testify/require"
)

func delDomain(t *testing.T, db *gorm.DB, id string) (int, map[string]interface{}) {
	r := newGin()
	r.DELETE("/network-domains/:id", DeleteNetworkDomain(db))
	w := perform(t, r, "DELETE", "/network-domains/"+id, "")
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func TestDeleteEmptyDomainSoftDeletes(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-empty", Name: "空网域", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})

	code, out := delDomain(t, db, "mc-empty")
	require.Equal(t, 200, code)
	data := out["data"].(map[string]interface{})
	assert.Equal(t, "mc-empty", data["id"])
	// 契约 §5.1.2：空网域级联影响清单为零
	cascade := data["cascade_impact"].(map[string]interface{})
	assert.Equal(t, float64(0), cascade["edge_agent_count"])
	retire, ok := cascade["will_retire_agents"].([]interface{})
	assert.True(t, ok, "will_retire_agents should be an array")
	assert.Len(t, retire, 0)

	// soft-deleted: row still exists but not visible via quety
	var count int64
	require.NoError(t, db.Unscoped().Model(&models.NetworkDomain{}).Where("id = ?", "mc-empty").Count(&count).Error)
	assert.Equal(t, int64(1), count)

	// second delete returns not_found
	code2, _ := delDomain(t, db, "mc-empty")
	assert.Equal(t, 404, code2)
}

func TestDeleteNonEmptyRejected(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-busy", Name: "非空", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	require.NoError(t, db.Create(&models.Host{
		ResourceCategory: models.ResourceCategoryHost, NetworkDomainID: "mc-busy", BizCode: "b",
		InstanceName: "h1", Status: "running", Region: "r", ZoneEnv: "z", InstanceSpec: "s", Image: "img",
		VPC: "v", SecurityGroup: "sg",
	}).Error)

	// 决策 82-1：有 M07 资源引用时返回 403 forbidden（不是 409 conflict）
	code, out := delDomain(t, db, "mc-busy")
	assert.Equal(t, 403, code)
	assert.Equal(t, "forbidden", out["errorType"])
	assert.Contains(t, out["error"].(string), "resource reference")

	// row not deleted
	var count int64
	require.NoError(t, db.Model(&models.NetworkDomain{}).Where("id = ?", "mc-busy").Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestDeleteManagedAgentCascadeImpact(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-agents", Name: "有agent", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	require.NoError(t, db.Create(&models.EdgeAgent{
		NetworkDomainID: "mc-agents", AgentType: models.AgentTypeVMAgent, Status: "online", Hostname: "host-online",
	}).Error)
	require.NoError(t, db.Create(&models.EdgeAgent{
		NetworkDomainID: "mc-agents", AgentType: models.AgentTypeVMAgent, Status: "offline", Hostname: "host-offline",
	}).Error)

	// 决策 82-1：已纳管 EdgeAgent 不再拒绝，改返回级联影响清单（契约 §5.1.2）
	code, out := delDomain(t, db, "mc-agents")
	assert.Equal(t, 200, code)

	// 验证返回级联影响清单：edge_agent_count = 实际退役 Agent 明细长度（含 offline，MEDIUM-4）
	data := out["data"].(map[string]interface{})
	assert.Empty(t, data["deleted"], "顶层 deleted 字段已移除")
	assert.Empty(t, data["cascade_retired"], "顶层 cascade_retired 字段已移除")
	cascade := data["cascade_impact"].(map[string]interface{})
	assert.Equal(t, float64(2), cascade["edge_agent_count"])
	retire := cascade["will_retire_agents"].([]interface{})
	assert.Len(t, retire, 2)
	statuses := map[string]bool{}
	for _, it := range retire {
		m := it.(map[string]interface{})
		assert.NotEmpty(t, m["id"])
		assert.NotEmpty(t, m["hostname"])
		statuses[m["status"].(string)] = true
	}
	assert.True(t, statuses["online"], "will_retire_agents 应含 online 明细")
	assert.True(t, statuses["offline"], "will_retire_agents 应含 offline 明细（offline 一并退场）")

	// 口径一致：名单长度 = 实际退役 Agent 数
	assert.Equal(t, cascade["edge_agent_count"], float64(len(retire)))
}

func TestDeleteManagementRejected(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "默认网域", DomainType: models.DomainTypeManagement,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})

	// 决策 82-1：管理域禁止删除，返回 400 bad_request（不是 409 conflict）
	code, out := delDomain(t, db, models.DefaultDomainID)
	assert.Equal(t, 400, code)
	assert.Equal(t, "bad_request", out["errorType"])
}

func TestDeleteOfflineAgentDoesNotBlock(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-offline", Name: "仅offline", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	require.NoError(t, db.Create(&models.EdgeAgent{
		NetworkDomainID: "mc-offline", AgentType: models.AgentTypeVMAgent, Status: "offline",
	}).Error)

	code, _ := delDomain(t, db, "mc-offline")
	assert.Equal(t, 200, code)
}
