package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetNetworkDomainOK(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-zhw-a", Name: "政务网A", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})

	r := newGin()
	r.GET("/network-domains/:id", GetNetworkDomain(db))
	w := perform(t, r, "GET", "/network-domains/mc-zhw-a", "")
	require.Equal(t, 200, w.Code)

	var out struct {
		Data models.NetworkDomain `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "mc-zhw-a", out.Data.ID)
	assert.Equal(t, []string{"platform_admin"}, out.Data.AuthorizedTenantIDs)
}

func TestGetNetworkDomainNotFound(t *testing.T) {
	db := openTestDB(t)
	r := newGin()
	r.GET("/network-domains/:id", GetNetworkDomain(db))
	w := perform(t, r, "GET", "/network-domains/nope", "")
	assert.Equal(t, 404, w.Code)
	var out struct{ ErrorType string `json:"errorType"` }
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	assert.Equal(t, "not_found", out.ErrorType)
}

func TestGetNetworkDomainIgnoresSoftDeleted(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-gone", Name: "已删", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled,
	})
	require.NoError(t, db.Delete(&models.NetworkDomain{}, "id = ?", "mc-gone").Error)

	r := newGin()
	r.GET("/network-domains/:id", GetNetworkDomain(db))
	w := perform(t, r, "GET", "/network-domains/mc-gone", "")
	assert.Equal(t, 404, w.Code)
}
