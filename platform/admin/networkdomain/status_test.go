package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
	"github.com/stretchr/testify/require"
)

func patchStatus(t *testing.T, db *gorm.DB, id, body string) (int, map[string]interface{}) {
	r := newGin()
	r.PATCH("/network-domains/:id/status", UpdateDomainStatus(db))
	w := perform(t, r, "PATCH", "/network-domains/"+id+"/status", body)
	var out map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out
}

func seedEdgeDomain(t *testing.T, db *gorm.DB) {
	t.Helper()
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-edge-a", Name: "边缘A", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	insertDomain(t, db, &models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "默认网域", DomainType: models.DomainTypeManagement,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
}

func TestDisableReturnsNestedImpact(t *testing.T) {
	db := openTestDB(t)
	seedEdgeDomain(t, db)

	// 1 offline agent (not managed) + 2 online agents (managed)
	require.NoError(t, db.Create(&models.EdgeAgent{
		NetworkDomainID: "mc-edge-a", AgentType: models.AgentTypeVMAgent, Status: "online",
	}).Error)
	require.NoError(t, db.Create(&models.EdgeAgent{
		NetworkDomainID: "mc-edge-a", AgentType: models.AgentTypeVMAgent, Status: "unknown",
	}).Error)
	require.NoError(t, db.Create(&models.EdgeAgent{
		NetworkDomainID: "mc-edge-a", AgentType: models.AgentTypeVMAgent, Status: "offline",
	}).Error)
	// 2 resources (1 host + 1 generic) referencing the domain
	require.NoError(t, db.Create(&models.Host{
		ResourceCategory: models.ResourceCategoryHost, NetworkDomainID: "mc-edge-a", BizCode: "b",
		InstanceName: "h1", Status: "running", Region: "r", ZoneEnv: "z", InstanceSpec: "s", Image: "img",
		VPC: "v", SecurityGroup: "sg",
	}).Error)
	require.NoError(t, db.Create(&models.GenericTarget{
		ResourceBase: models.ResourceBase{
			ResourceID: "g1", ResourceCategory: models.ResourceCategoryGenericTarget,
			NetworkDomainID: "mc-edge-a", BizCode: "b", Env: "prod", Status: "up", SourceType: models.SourceTypeManual,
		},
		TargetName: "t1", InstanceIP: "1.2.3.4", Port: 9100, ResourceType: models.ResourceTypeGenericTarget,
	}).Error)

	code, out := patchStatus(t, db, "mc-edge-a", `{"status":"disabled"}`)
	require.Equal(t, 200, code)
	data := out["data"].(map[string]interface{})
	assert.Equal(t, "disabled", data["status"])
	assert.Equal(t, "mc-edge-a", data["id"])
	assert.Equal(t, "边缘A", data["name"])
	// 契约 §5.1.1：禁用响应为嵌套 impact 结构
	impact := data["impact"].(map[string]interface{})
	assert.Equal(t, float64(2), impact["resource_count"])
	assert.Equal(t, float64(2), impact["managed_edge_agent_count"])
	assert.Equal(t, true, impact["has_online_agents"], "存在 online Agent 时应为 true")
	// 决策 82-2：unknown 不计为在线，此处已有 online，故 has_online_agents=true

	// persisted
	var dom models.NetworkDomain
	require.NoError(t, db.Where("id = ?", "mc-edge-a").First(&dom).Error)
	assert.Equal(t, models.DomainStatusDisabled, dom.Status)
}

func TestReEnable(t *testing.T) {
	db := openTestDB(t)
	seedEdgeDomain(t, db)

	_, _ = patchStatus(t, db, "mc-edge-a", `{"status":"disabled"}`)
	code, out := patchStatus(t, db, "mc-edge-a", `{"status":"enabled"}`)
	require.Equal(t, 200, code)
	data := out["data"].(map[string]interface{})
	assert.Equal(t, "enabled", data["status"])

	var dom models.NetworkDomain
	require.NoError(t, db.Where("id = ?", "mc-edge-a").First(&dom).Error)
	assert.Equal(t, models.DomainStatusEnabled, dom.Status)
}

func TestManagementCannotDisable(t *testing.T) {
	db := openTestDB(t)
	seedEdgeDomain(t, db)

	code, out := patchStatus(t, db, models.DefaultDomainID, `{"status":"disabled"}`)
	assert.Equal(t, 400, code)
	assert.Equal(t, "bad_request", out["errorType"])
}

func TestInvalidStatusValue(t *testing.T) {
	db := openTestDB(t)
	seedEdgeDomain(t, db)
	code, _ := patchStatus(t, db, "mc-edge-a", `{"status":"bogus"}`)
	assert.Equal(t, 400, code)
}

func TestStatusNotFound(t *testing.T) {
	db := openTestDB(t)
	code, _ := patchStatus(t, db, "nope", `{"status":"disabled"}`)
	assert.Equal(t, 404, code)
}
