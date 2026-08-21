package networkdomain

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func postCreate(t *testing.T, db *gorm.DB, body string) (int, models.NetworkDomain, string) {
	r := newGin()
	r.POST("/network-domains", CreateNetworkDomain(db))
	w := perform(t, r, "POST", "/network-domains", body)
	var out struct {
		Data  models.NetworkDomain `json:"data"`
		Error string               `json:"error"`
		Type  string               `json:"errorType"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out.Data, out.Error + "|" + out.Type
}

func TestCreateNetworkDomainOK(t *testing.T) {
	db := openTestDB(t)
	code, d, _ := postCreate(t, db, `{"name":"政务网A区","domain_type":"edge","zone_type":"internet","domain_code":"zhw-a","description":"测试"}`)
	require.Equal(t, 200, code)
	assert.Equal(t, "mc-zhw-a", d.ID)
	assert.Equal(t, models.DomainTypeEdge, d.DomainType)
	assert.Equal(t, models.PlatformAdminTenantID, d.TenantID)
	assert.Equal(t, []string{models.PlatformAdminTenantID}, d.AuthorizedTenantIDs)
	assert.Equal(t, models.DomainStatusEnabled, d.Status)
	assert.Equal(t, "政务网A区", d.Name)
}

func TestCreateNetworkDomainBackfillsAuthorizedDefault(t *testing.T) {
	db := openTestDB(t)
	// no authorized_tenant_ids nor domain_code provided
	code, d, _ := postCreate(t, db, `{"name":"边缘A","domain_type":"edge"}`)
	require.Equal(t, 200, code)
	assert.NotEmpty(t, d.ID)
	assert.NotEqual(t, models.DefaultDomainID, d.ID)
	assert.Equal(t, []string{models.PlatformAdminTenantID}, d.AuthorizedTenantIDs)
}

func TestCreateNetworkDomainIgnoresClientTenant(t *testing.T) {
	db := openTestDB(t)
	// a malicious/ignorant payload tries to set tenant_id=t2
	code, d, _ := postCreate(t, db, `{"name":"x","domain_type":"edge","tenant_id":"t2","domain_code":"zhw-x"}`)
	require.Equal(t, 200, code)
	assert.Equal(t, models.PlatformAdminTenantID, d.TenantID)
}

func TestCreateNetworkDomainMissingName(t *testing.T) {
	db := openTestDB(t)
	code, _, _ := postCreate(t, db, `{"domain_type":"edge"}`)
	assert.Equal(t, 400, code)
}

func TestCreateNetworkDomainMissingDomainType(t *testing.T) {
	db := openTestDB(t)
	code, _, _ := postCreate(t, db, `{"name":"x"}`)
	assert.Equal(t, 400, code)
}

func TestCreateNetworkDomainInvalidDomainType(t *testing.T) {
	db := openTestDB(t)
	code, _, _ := postCreate(t, db, `{"name":"x","domain_type":"bogus"}`)
	assert.Equal(t, 400, code)
}

func TestCreateNetworkDomainReservedDefault(t *testing.T) {
	db := openTestDB(t)
	code, _, _ := postCreate(t, db, `{"name":"x","domain_type":"edge","domain_code":"default"}`)
	assert.Equal(t, 400, code)
}

func TestCreateNetworkDomainDuplicateConflict(t *testing.T) {
	db := openTestDB(t)
	code1, _, _ := postCreate(t, db, `{"name":"a","domain_type":"edge","domain_code":"zhw-a"}`)
	require.Equal(t, 200, code1)
	code2, _, err := postCreate(t, db, `{"name":"b","domain_type":"edge","domain_code":"zhw-a"}`)
	assert.Equal(t, 409, code2)
	assert.Contains(t, err, "conflict")
}

func TestCreateNetworkDomainInvalidDomainCode(t *testing.T) {
	db := openTestDB(t)
	code, _, _ := postCreate(t, db, `{"name":"a","domain_type":"edge","domain_code":"Bad_Code"}`)
	assert.Equal(t, 400, code)
}

// TestCreateNetworkDomainAfterSoftDeleteConflict verifies that re-registering a
// domain_code whose previous row was soft-deleted returns a clean 409 conflict
// (not a 500) because the soft-deleted primary key still physically exists.
func TestCreateNetworkDomainAfterSoftDeleteConflict(t *testing.T) {
	db := openTestDB(t)

	// register a domain
	code1, d, _ := postCreate(t, db, `{"name":"政务网A区","domain_type":"edge","domain_code":"zhw-again"}`)
	require.Equal(t, 200, code1)
	require.Equal(t, "mc-zhw-again", d.ID)

	// report-soft delete it (empty domain -> allowed)
	r := newGin()
	r.DELETE("/network-domains/:id", DeleteNetworkDomain(db))
	w := perform(t, r, "DELETE", "/network-domains/mc-zhw-again", "")
	require.Equal(t, 200, w.Code)

	// re-register the same domain_code after soft delete -> 409 conflict, not 500
	code2, _, errStr := postCreate(t, db, `{"name":"重登","domain_type":"edge","domain_code":"zhw-again"}`)
	assert.Equal(t, 409, code2, "re-registering a soft-deleted domain should be 409, got %d", code2)
	parts := strings.Split(errStr, "|")
	require.Len(t, parts, 2)
	assert.Equal(t, "conflict", parts[1], "errorType should be conflict, got %q", errStr)
}
