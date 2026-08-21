package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/admin/networkdomain"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func buildIntegrationEngine(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ZoneType{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.EdgeAgent{},
		&models.LabelTemplate{},
		&models.ExporterTemplate{},
		&models.CITypeExporterMapping{},
	))
	require.NoError(t, seed.Run(db))

	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	networkdomain.RegisterRoutes(platform, db)
	return r, db
}

func TestEndToEndDomainRegistry(t *testing.T) {
	r, _ := buildIntegrationEngine(t)

	exec := func(method, path, body string) (int, map[string]interface{}) {
		t.Helper()
		httpReq := httptest.NewRequest(method, "http://mc.local"+path, strings.NewReader(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httpReq)
		var out map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}

	// 0. seeded default domain present
	{
		code, out := exec("GET", "/api/v2/platform/network-domains", "")
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		found := false
		for _, it := range data["list"].([]interface{}) {
			if it.(map[string]interface{})["id"] == models.DefaultDomainID {
				found = true
			}
		}
		assert.True(t, found, "default domain should be seeded")
	}

	// 1. zone-types returns enabled dictionary (non-paginated array)
	{
		code, out := exec("GET", "/api/v2/platform/zone-types", "")
		require.Equal(t, http.StatusOK, code)
		arr, ok := out["data"].([]interface{})
		require.True(t, ok, "zone-types data should be an array")
		assert.Len(t, arr, 4)
	}

	// 2. register an edge domain
	id := ""
	{
		code, out := exec("POST", "/api/v2/platform/network-domains",
			`{"name":"政务网A区","domain_type":"edge","zone_type":"internet","domain_code":"zhw-a"}`)
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		id = data["id"].(string)
		assert.Equal(t, "mc-zhw-a", id)
		assert.Equal(t, models.PlatformAdminTenantID, data["tenant_id"])
	}

	// 3. list by status includes the new domain
	{
		code, out := exec("GET", "/api/v2/platform/network-domains?status=enabled&tenant_id="+models.PlatformAdminTenantID, "")
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		assert.NotZero(t, data["total"].(float64))
	}

	// 4. detail
	{
		code, out := exec("GET", "/api/v2/platform/network-domains/"+id, "")
		require.Equal(t, http.StatusOK, code)
		assert.Equal(t, id, out["data"].(map[string]interface{})["id"])
	}

	// 5. edit editable fields; tenant_id immutable
	{
		code, out := exec("PUT", "/api/v2/platform/network-domains/"+id,
			`{"name":"政务网A区(改)","zone_type":"extranet"}`)
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		assert.Equal(t, "政务网A区(改)", data["name"])
		assert.Equal(t, models.PlatformAdminTenantID, data["tenant_id"])
	}

	// 6. disable empty domain returns flat impact scope
	{
		code, out := exec("PATCH", "/api/v2/platform/network-domains/"+id+"/status", `{"status":"disabled"}`)
		require.Equal(t, http.StatusOK, code)
		data := out["data"].(map[string]interface{})
		assert.Equal(t, float64(0), data["resource_count"])
		assert.Equal(t, float64(0), data["managed_edge_agent_count"])
	}

	// 6b. default management domain cannot be disabled/deleted
	{
		code, _ := exec("PATCH", "/api/v2/platform/network-domains/"+models.DefaultDomainID+"/status", `{"status":"disabled"}`)
		assert.Equal(t, 409, code)
		code2, _ := exec("DELETE", "/api/v2/platform/network-domains/"+models.DefaultDomainID, "")
		assert.Equal(t, 409, code2)
	}

	// 7. re-enable then delete the (now enabled, empty) domain
	{
		code, _ := exec("PATCH", "/api/v2/platform/network-domains/"+id+"/status", `{"status":"enabled"}`)
		require.Equal(t, http.StatusOK, code)
		code2, _ := exec("DELETE", "/api/v2/platform/network-domains/"+id, "")
		require.Equal(t, http.StatusOK, code2)
		code3, _ := exec("DELETE", "/api/v2/platform/network-domains/"+id, "")
		assert.Equal(t, 404, code3)
	}
}
