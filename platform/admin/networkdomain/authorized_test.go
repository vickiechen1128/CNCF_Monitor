package networkdomain

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAuthorizedTenantsDefaultBackfill(t *testing.T) {
	db := openTestDB(t)
	require.NoError(t, db.Create(&models.Tenant{ID: models.PlatformAdminTenantID, Name: "平台默认租户", Status: models.TenantStatusActive}).Error)

	code, d, _ := postCreate(t, db, `{"name":"政务网A","domain_type":"edge","domain_code":"zhw-a"}`)
	require.Equal(t, 200, code)
	assert.Equal(t, []string{models.PlatformAdminTenantID}, d.AuthorizedTenantIDs)

	// platform_admin tenant synced with the domain id
	var t2 models.Tenant
	require.NoError(t, db.Where("id = ?", models.PlatformAdminTenantID).First(&t2).Error)
	assert.Contains(t, t2.NetworkDomainIDs, "mc-zhw-a")
}

func TestAuthorizedTenantsEditAddsAndRemoves(t *testing.T) {
	db := openTestDB(t)
	for _, id := range []string{models.PlatformAdminTenantID, "t-tenant-b", "t-tenant-c"} {
		require.NoError(t, db.Create(&models.Tenant{ID: id, Name: id, Status: models.TenantStatusActive}).Error)
	}
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-share", Name: "共享网域", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})

	// add leases to include new tenants (multi-tenant sharing)
	code, d := putUpdate(t, db, "mc-share", `{"authorized_tenant_ids":["platform_admin","t-tenant-b"]}`)
	require.Equal(t, 200, code)
	assert.Equal(t, []string{"platform_admin", "t-tenant-b"}, d.AuthorizedTenantIDs)

	var tb models.Tenant
	require.NoError(t, db.Where("id = ?", "t-tenant-b").First(&tb).Error)
	assert.Contains(t, tb.NetworkDomainIDs, "mc-share")

	// remove a tenant by clearing the list
	code2, d2 := putUpdate(t, db, "mc-share", `{"authorized_tenant_ids":["t-tenant-c"]}`)
	require.Equal(t, 200, code2)
	assert.Equal(t, []string{"t-tenant-c"}, d2.AuthorizedTenantIDs)
}

func TestAuthorizedTenantsClearToEmpty(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-share", Name: "共享", DomainType: models.DomainTypeEdge,
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	code, d := putUpdate(t, db, "mc-share", `{"authorized_tenant_ids":[]}`)
	require.Equal(t, 200, code)
	assert.Empty(t, d.AuthorizedTenantIDs)
}
