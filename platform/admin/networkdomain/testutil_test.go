package networkdomain

import (
	"fmt"
	"io"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// memDBCounter produces a unique in-memory DB name per test so sequential and
// parallel tests in one package never share the same backing database.
var memDBCounter int64

// openTestDB opens a per-test in-memory SQLite database with exactly the tables
// the networkdomain package touches.
func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:netdom_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
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
	))
	return db
}

func newGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

// perform executes a request against the given engine and returns the recorder.
func perform(t *testing.T, r *gin.Engine, method, path string, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// seedZoneTypes inserts a mix of enabled and disabled dictionary entries.
func seedZoneTypes(t *testing.T, db *gorm.DB) {
	t.Helper()
	items := []models.ZoneType{
		{Code: "internet", DisplayName: "互联网区", Description: "互联网区", Enabled: true},
		{Code: "extranet", DisplayName: "政务外网区", Description: "政务外网区", Enabled: true},
		{Code: "dmz", DisplayName: "DMZ区", Description: "DMZ区", Enabled: false},
	}
	for i := range items {
		require.NoError(t, db.Create(&items[i]).Error)
	}
}

// seedTenants inserts the platform_admin and biz-ops tenants plus one
// suspended tenant so status filtering can be exercised.
func seedTenants(t *testing.T, db *gorm.DB) {
	t.Helper()
	items := []models.Tenant{
		{ID: models.PlatformAdminTenantID, Name: "平台默认租户", Status: models.TenantStatusActive, IsPlatformAdmin: true},
		{ID: "t-biz-ops", Name: "平台运营部", Status: models.TenantStatusActive},
		{ID: "t-suspended", Name: "停用租户", Status: models.TenantStatusSuspended},
	}
	for i := range items {
		require.NoError(t, db.Create(&items[i]).Error)
	}
}

// insertDomain persists a network domain row directly (test fixture helper).
func insertDomain(t *testing.T, db *gorm.DB, d *models.NetworkDomain) {
	t.Helper()
	require.NoError(t, db.Create(d).Error)
}
