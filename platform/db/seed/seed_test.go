package seed

import (
	"strconv"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newTestDB opens an in-memory SQLite database and migrates exactly the tables
// needed by the seed package.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
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

	for _, code := range []models.ZoneTypeCode{
		models.ZoneTypeInternet, models.ZoneTypeExtranet,
		models.ZoneTypePrivateLine, models.ZoneTypeDMZ,
	} {
		var zt models.ZoneType
		require.NoError(t, db.Where("code = ?", string(code)).First(&zt).Error)
		assert.True(t, zt.Enabled, "zone_type %s should be enabled", code)
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