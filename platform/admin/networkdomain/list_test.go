package networkdomain

import (
	"encoding/json"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListNetworkDomains(t *testing.T) {
	db := openTestDB(t)
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-zhw-a", Name: "政务网A", DomainType: models.DomainTypeEdge, ZoneType: "internet",
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin"},
		Status: models.DomainStatusEnabled,
	})
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-zhw-b", Name: "政务网B", DomainType: models.DomainTypeEdge, ZoneType: "extranet",
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"platform_admin", "t2"},
		Status: models.DomainStatusDisabled,
	})
	insertDomain(t, db, &models.NetworkDomain{
		ID: "mc-hos-a", Name: "医院A专网", DomainType: models.DomainTypeEdge, ZoneType: "private-line",
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{"t-health", "tcdc"},
		Status: models.DomainStatusEnabled,
	})

	type listData struct {
		List     []models.NetworkDomain `json:"list"`
		Total    int64                  `json:"total"`
		Page     int                    `json:"page"`
		PageSize int                    `json:"page_size"`
	}
	getList := func(t *testing.T, query string) (listData, string) {
		r := newGin()
		r.GET("/network-domains", ListNetworkDomains(db))
		w := perform(t, r, "GET", "/network-domains"+query, "")
		require.Equal(t, 200, w.Code)
		var out struct {
			Status string   `json:"status"`
			Data   listData `json:"data"`
			Error  string   `json:"error"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		return out.Data, out.Error
	}

	t.Run("returns all with pagination envelope", func(t *testing.T) {
		data, _ := getList(t, "")
		assert.Equal(t, int64(3), data.Total)
		assert.Len(t, data.List, 3)
		assert.Equal(t, 1, data.Page)
		assert.Equal(t, 20, data.PageSize)
	})

	t.Run("honours page and page_size", func(t *testing.T) {
		data, _ := getList(t, "?page=2&page_size=1")
		assert.Equal(t, int64(3), data.Total)
		assert.Len(t, data.List, 1)
		assert.Equal(t, 2, data.Page)
		assert.Equal(t, 1, data.PageSize)
	})

	t.Run("clamps oversized page_size", func(t *testing.T) {
		data, _ := getList(t, "?page_size=5000")
		assert.Equal(t, maxPageSize, data.PageSize)
	})

	t.Run("invalid page defaults to 1", func(t *testing.T) {
		data, _ := getList(t, "?page=abc")
		assert.Equal(t, 1, data.Page)
	})

	t.Run("filters by status", func(t *testing.T) {
		data, _ := getList(t, "?status=enabled")
		assert.Equal(t, int64(2), data.Total)
	})

	t.Run("filters by zone_type", func(t *testing.T) {
		data, _ := getList(t, "?zone_type=internet")
		assert.Equal(t, int64(1), data.Total)
		assert.Equal(t, "mc-zhw-a", data.List[0].ID)
	})

	t.Run("filters by tenant as authorized or owner", func(t *testing.T) {
		data, _ := getList(t, "?tenant_id=t2")
		assert.Equal(t, int64(1), data.Total)
		assert.Equal(t, "mc-zhw-b", data.List[0].ID)
	})

	t.Run("filters by name fuzzy", func(t *testing.T) {
		data, _ := getList(t, "?name=政务")
		assert.Equal(t, int64(2), data.Total)
	})

	t.Run("empty result", func(t *testing.T) {
		data, _ := getList(t, "?zone_type=dmz")
		assert.Equal(t, int64(0), data.Total)
		assert.Len(t, data.List, 0)
	})
}
