package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestListTenantsSeeded asserts the tenant dictionary endpoint returns the
// seeded platform_admin + biz-ops tenants with the platform list envelope.
func TestListTenantsSeeded(t *testing.T) {
	db := openTestDB(t)
	seedTenants(t, db)

	r := newGin()
	r.GET("/tenants", ListTenants(db))
	w := perform(t, r, "GET", "/tenants", "")
	require.Equal(t, 200, w.Code)

	var out struct {
		Data struct {
			List []models.Tenant `json:"list"`
			Page int             `json:"page"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, 1, out.Data.Page)
	assert.NotEmpty(t, out.Data.List)
}

// TestListTenantsStatusFilter asserts the status query filters the dictionary.
func TestListTenantsStatusFilter(t *testing.T) {
	db := openTestDB(t)
	seedTenants(t, db)

	r := newGin()
	r.GET("/tenants", ListTenants(db))
	w := perform(t, r, "GET", "/tenants?status=active", "")
	require.Equal(t, 200, w.Code)

	var out struct {
		Data struct {
			List []models.Tenant `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, 2, len(out.Data.List))
}