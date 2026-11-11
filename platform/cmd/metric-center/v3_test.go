package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
	m06 "github.com/metriccenter/metriccenter/platform/modules/m06"
)

func TestResolveDatabaseMode(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_MODE", "")

	mode, err := resolveDatabaseMode("")
	require.NoError(t, err)
	assert.Equal(t, db.StartupModeLegacy, mode, "empty mode defaults to legacy")

	t.Setenv("METRIC_CENTER_DB_MODE", "v3")
	mode, err = resolveDatabaseMode("")
	require.NoError(t, err)
	assert.Equal(t, db.StartupModeV3, mode, "env selects v3")

	mode, err = resolveDatabaseMode("legacy")
	require.NoError(t, err)
	assert.Equal(t, db.StartupModeLegacy, mode, "flag overrides env")

	_, err = resolveDatabaseMode("bogus")
	assert.Error(t, err)

	mode, err = resolveDatabaseMode(" V3 ")
	require.NoError(t, err)
	assert.Equal(t, db.StartupModeV3, mode, "mode is trimmed and lower-cased")
}

func TestSetupV3RouterMountsSystemM06M07(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_router.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	hash, err := bcrypt.GenerateFromPassword([]byte("viewer123"), bcrypt.DefaultCost)
	require.NoError(t, err)
	require.NoError(t, gormDB.Create(&models.User{
		ID: "user-viewer", TenantID: models.PlatformAdminTenantID, Username: "viewer",
		PasswordHash: string(hash), DisplayName: "只读用户",
		Role: models.UserRoleUser, Status: models.UserStatusActive,
	}).Error)

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router("", m06.Options{})
	require.NoError(t, err)

	cases := []struct {
		path string
		want int
	}{
		{"/api/v3/platform/health", http.StatusOK},
		{"/api/v3/platform/ready", http.StatusOK},
		{"/api/v3/platform/meta", http.StatusOK},
		// Business routes stay behind the global auth gate.
		{"/api/v3/platform/resources", http.StatusUnauthorized},
		{"/api/v3/platform/tenants", http.StatusUnauthorized},
		{"/api/v3/platform/network-domains", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		assert.Equal(t, tc.want, rec.Code, tc.path)
		assert.NotEmpty(t, rec.Header().Get("X-Request-ID"), "request id header on %s", tc.path)
	}

	anonRec := httptest.NewRecorder()
	router.ServeHTTP(anonRec, httptest.NewRequest(http.MethodPost, "/api/v3/platform/network-domains",
		strings.NewReader(`{"name":"x"}`)))
	assert.Equal(t, http.StatusUnauthorized, anonRec.Code, "mutations are behind the global auth gate")

	metaRec := httptest.NewRecorder()
	router.ServeHTTP(metaRec, httptest.NewRequest(http.MethodGet, "/api/v3/platform/meta", nil))
	var meta struct {
		Data struct {
			Modules []string `json:"modules"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(metaRec.Body.Bytes(), &meta))
	assert.Equal(t, []string{"system", "m06", "m07", "auth"}, meta.Data.Modules)

	// Login is anonymous on the v3 prefix, and its token unlocks M07 routes.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/auth/login",
		strings.NewReader(`{"username":"admin","password":"admin123"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &login))
	require.NotEmpty(t, login.Data.Token)

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/resources?resource_category=host", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/tenants", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/network-domains", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// A normal user is authenticated but forbidden from the admin surface.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v3/platform/auth/login",
		strings.NewReader(`{"username":"viewer","password":"viewer123"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &login))

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/tenants", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
}

func v3LoginToken(t *testing.T, router http.Handler, username, password string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/auth/login",
		strings.NewReader(`{"username":"`+username+`","password":"`+password+`"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &login))
	require.NotEmpty(t, login.Data.Token)
	return login.Data.Token
}

func TestV3UserDisableInvalidatesSession(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_user_session.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router("", m06.Options{})
	require.NoError(t, err)

	adminToken := v3LoginToken(t, router, "admin", "admin123")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/users",
		strings.NewReader(`{"username":"ops01","display_name":"运维一号","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	require.NotEmpty(t, created.Data.ID)

	opsToken := v3LoginToken(t, router, "ops01", "secret123")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/resources?resource_category=host", nil)
	req.Header.Set("Authorization", "Bearer "+opsToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPatch, "/api/v3/platform/users/"+created.Data.ID+"/status",
		strings.NewReader(`{"status":"disabled"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/resources?resource_category=host", nil)
	req.Header.Set("Authorization", "Bearer "+opsToken)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "disabling a user must invalidate existing sessions")
}

func TestV3StorageRoutesUseInjectedOptions(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_storage.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	router, err := setupV3Router("", m06.Options{EnvFile: envFile})
	require.NoError(t, err)
	adminToken := v3LoginToken(t, router, "admin", "admin123")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v3/platform/storage-logs", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/v3/platform/storage-logs/retention",
		strings.NewReader(`{"time":"30d","size":"20GB"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	content, err := os.ReadFile(envFile)
	require.NoError(t, err)
	assert.Contains(t, string(content), "PROM_RETENTION_TIME=30d")
}
