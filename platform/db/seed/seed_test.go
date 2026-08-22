package seed

import (
	"fmt"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// seedDBSeq keeps each call to newTestDB on a fresh, isolated in-memory
// database so tests never pollute one another via the shared cache DSN.
var seedDBSeq int64

// newTestDB opens an in-memory SQLite database and migrates exactly the tables
// needed by the seed package.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&seedDBSeq, 1)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:seed_%d?mode=memory&cache=shared", n)), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ZoneType{},
		&models.LabelTemplate{},
		&models.ExporterTemplate{},
		&models.CITypeExporterMapping{},
	))
	return db
}

// countRows returns the number of rows in the given model table.
func countRows(t *testing.T, db *gorm.DB, model interface{}, out *int64) {
	t.Helper()
	require.NoError(t, db.Model(model).Count(out).Error)
}

func TestRunSeedsTenantAndDefaultDomain(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))

	var tenant models.Tenant
	require.NoError(t, db.Where("id = ?", models.PlatformAdminTenantID).First(&tenant).Error)
	assert.Equal(t, "平台默认租户", tenant.Name)
	assert.True(t, tenant.IsPlatformAdmin)
	assert.False(t, tenant.MultiSiteEnabled)
	assert.Contains(t, tenant.NetworkDomainIDs, models.DefaultDomainID)

	var dom models.NetworkDomain
	require.NoError(t, db.Where("id = ?", models.DefaultDomainID).First(&dom).Error)
	assert.Equal(t, models.DomainTypeManagement, dom.DomainType)
	assert.Equal(t, models.ChannelTypeLocal, dom.Channel)
	assert.Equal(t, models.PlatformAdminTenantID, dom.TenantID)
	assert.Equal(t, models.DomainStatusEnabled, dom.Status)
}

func TestRunSeedsZoneTypes(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))

	// 验收基线：仅 政务外网区 / 互联网区 启用，专线区 / DMZ区 保留但禁用
	enabled := []models.ZoneTypeCode{models.ZoneTypeExtranet, models.ZoneTypeInternet}
	disabled := []models.ZoneTypeCode{models.ZoneTypePrivateLine, models.ZoneTypeDMZ}
	for _, code := range enabled {
		var zt models.ZoneType
		require.NoError(t, db.Where("code = ?", string(code)).First(&zt).Error)
		assert.True(t, zt.Enabled, "zone_type %s should be enabled", code)
	}
	for _, code := range disabled {
		var zt models.ZoneType
		require.NoError(t, db.Where("code = ?", string(code)).First(&zt).Error)
		assert.False(t, zt.Enabled, "zone_type %s should be disabled", code)
	}
}

func TestRunSeedsLabelTemplates(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))

	cats := models.ValidResourceCategories()
	var total int64
	countRows(t, db, &models.LabelTemplate{}, &total)
	assert.Equal(t, int64(len(cats)), total, "one default template per resource category")

	var tmpl models.LabelTemplate
	require.NoError(t, db.Where("name = ?", "default-host").First(&tmpl).Error)
	assert.Equal(t, models.ResourceCategoryHost, tmpl.ResourceCategory)
	assert.True(t, tmpl.IsDefault)

	// 断言 default-host 含 biz_code→biz 与 instance_ip:port→instance 映射
	for _, target := range []string{"biz", "instance"} {
		found := false
		for _, m := range tmpl.Mappings {
			if m.TargetLabel == target {
				found = true
				break
			}
		}
		assert.True(t, found, "default-host should contain mapping to label %q", target)
	}
}

func TestRunSeedsExportersAndMappings(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))

	for _, name := range []string{"node-exporter", "mysqld-exporter", "redis-exporter", "windows-exporter"} {
		var e models.ExporterTemplate
		require.NoError(t, db.Where("name = ?", name).First(&e).Error)
		assert.True(t, e.IsBuiltin)
	}

	for _, mt := range []string{"host_linux", "host_windows", "mysql", "redis"} {
		var m models.CITypeExporterMapping
		require.NoError(t, db.Where("monitor_type = ?", mt).First(&m).Error)
		assert.True(t, m.IsDefault)
		assert.NotEmpty(t, m.ExporterTemplateID)

		// ExporterTemplateID must be a valid reference that joins back to the
		// ExporterTemplate.ID it points to (not a name).
		var e models.ExporterTemplate
		require.NoError(t, db.Where("id = ?", m.ExporterTemplateID).First(&e).Error)
		assert.True(t, e.IsBuiltin)
		assert.Equal(t, strconv.FormatUint(uint64(e.ID), 10), m.ExporterTemplateID)
	}
}

func TestRunIsIdempotent(t *testing.T) {
	db := newTestDB(t)

	require.NoError(t, Run(db))
	require.NoError(t, Run(db))

	var tenants, domains, zones, templates, exporters, mappings int64
	countRows(t, db, &models.Tenant{}, &tenants)
	countRows(t, db, &models.NetworkDomain{}, &domains)
	countRows(t, db, &models.ZoneType{}, &zones)
	countRows(t, db, &models.LabelTemplate{}, &templates)
	countRows(t, db, &models.ExporterTemplate{}, &exporters)
	countRows(t, db, &models.CITypeExporterMapping{}, &mappings)

	assert.Equal(t, int64(1), tenants, "tenant is unique")
	assert.Equal(t, int64(1), domains, "default domain is unique")
	assert.Equal(t, int64(4), zones, "zone_type dictionary is unique")
	assert.Equal(t, int64(5), templates, "label templates are unique")
	assert.Equal(t, int64(4), exporters, "exporters are unique")
	assert.Equal(t, int64(4), mappings, "ci_type_exporter_mappings are unique")
}

func TestRunNilDBReturnsError(t *testing.T) {
	assert.Error(t, Run(nil))
}
// TestRunSeedsDefaultDomainAuthorized verifies the default management domain is
// seeded with registration ownership = platform_admin and the authorized tenant
// = platform_admin (T06-10).
func TestRunSeedsDefaultDomainAuthorized(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, Run(db))

	var dom models.NetworkDomain
	require.NoError(t, db.Where("id = ?", models.DefaultDomainID).First(&dom).Error)
	assert.Equal(t, models.DomainTypeManagement, dom.DomainType)
	assert.Equal(t, models.ChannelTypeLocal, dom.Channel)
	assert.Equal(t, models.PlatformAdminTenantID, dom.TenantID)
	assert.Equal(t, models.DomainStatusEnabled, dom.Status)
	assert.Equal(t, []string{models.PlatformAdminTenantID}, dom.AuthorizedTenantIDs)
}

// TestRunBackfillsAuthorizedOnExistingDefault simulates a Phase 0 pre-created
// default domain that lacks AuthorizedTenantIDs and verifies Run idempotently
// back-fills it without duplicating records (T06-10).
func TestRunBackfillsAuthorizedOnExistingDefault(t *testing.T) {
	db := newTestDB(t)

	// Phase 0 row without authorized_tenant_ids
	legacy := &models.NetworkDomain{
		ID:         models.DefaultDomainID,
		Name:       "默认网域",
		DomainType: models.DomainTypeManagement,
		Channel:    models.ChannelTypeLocal,
		TenantID:   models.PlatformAdminTenantID,
		Status:     models.DomainStatusEnabled,
	}
	require.NoError(t, db.Create(legacy).Error)

	require.NoError(t, Run(db))

	var dom models.NetworkDomain
	require.NoError(t, db.Where("id = ?", models.DefaultDomainID).First(&dom).Error)
	assert.Equal(t, []string{models.PlatformAdminTenantID}, dom.AuthorizedTenantIDs)

	var n int64
	require.NoError(t, db.Model(&models.NetworkDomain{}).Where("id = ?", models.DefaultDomainID).Count(&n).Error)
	assert.Equal(t, int64(1), n, "no duplicate rows after back-fill")
}
