package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/db/seed"
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

func TestSetupV3RouterMountsSystemAndM07(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_router.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router("")
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
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		assert.Equal(t, tc.want, rec.Code, tc.path)
		assert.NotEmpty(t, rec.Header().Get("X-Request-ID"), "request id header on %s", tc.path)
	}

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
}
