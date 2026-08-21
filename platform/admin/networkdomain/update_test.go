package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"gorm.io/gorm"
	"github.com/stretchr/testify/require"
)

func putUpdate(t *testing.T, db *gorm.DB, id, body string) (int, models.NetworkDomain) {
	r := newGin()
	r.PUT("/network-domains/:id", UpdateNetworkDomain(db))
	w := perform(t, r, "PUT", "/network-domains/"+id, body)
	var out struct{ Data models.NetworkDomain `json:"data"` }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out.Data
}

func TestUpdateNetworkDomainEditableFields(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-zhw-a", Name: "旧名", Description: "旧描述", DomainType: models.DomainTypeEdge, ZoneType: "internet",
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})

	code, d := putUpdate(t, db, "mc-zhw-a", `{"name":"新名","description":"新描述","zone_type":"extranet","authorized_tenant_ids":["platform_admin","t2"]}`)
	require.Equal(t, 200, code)
	assert.Equal(t, "新名", d.Name)
	assert.Equal(t, "新描述", d.Description)
	assert.Equal(t, "extranet", d.ZoneType)
	assert.Equal(t, []string{"platform_admin", "t2"}, d.AuthorizedTenantIDs)
	// tenant_id and domain_type are immutable
	assert.Equal(t, models.PlatformAdminTenantID, d.TenantID)
	assert.Equal(t, models.DomainTypeEdge, d.DomainType)
}

func TestUpdateNetworkDomainTenantIgnored(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-zhw-a", Name: "x", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	// tenant_id, id, status, domain_type sent in body must be ignored
	code, d := putUpdate(t, db, "mc-zhw-a", `{"name":"y","tenant_id":"t2","id":"hijack","status":"disabled","domain_type":"management"}`)
	require.Equal(t, 200, code)
	assert.Equal(t, models.PlatformAdminTenantID, d.TenantID)
	assert.Equal(t, "mc-zhw-a", d.ID)
	assert.Equal(t, models.DomainStatusEnabled, d.Status)
	assert.Equal(t, models.DomainTypeEdge, d.DomainType)
	assert.Equal(t, "y", d.Name)
}

func TestUpdateNetworkDomainNotFound(t *testing.T) {
	db := openTestDB(t)
	code, _ := putUpdate(t, db, "nope", `{"name":"x"}`)
	assert.Equal(t, 404, code)
}

func TestUpdateNetworkDomainDefaultAllowedForName(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: models.DefaultDomainID, Name: "默认网域", DomainType: models.DomainTypeManagement,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	// default domain can be renamed but ownership/type immutable
	code, d := putUpdate(t, db, models.DefaultDomainID, `{"name":"默认网域(改)"}`)
	require.Equal(t, 200, code)
	assert.Equal(t, "默认网域(改)", d.Name)
	assert.Equal(t, models.DomainTypeManagement, d.DomainType)
}
