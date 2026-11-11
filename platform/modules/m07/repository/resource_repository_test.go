package repository

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openRepositoryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m07_repository.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on&_busy_timeout=5000"), &gorm.Config{
		Logger: logger.Discard,
	})
	require.NoError(t, err)

	for _, stmt := range []string{
		// 00000 core tables already exist; only seed the rows M07 reads.
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status) VALUES ('mc-demo','演示采集域','edge','platform_admin','agent_pull','enabled')`,
		`INSERT INTO business_domains(code,name) VALUES ('payment','支付')`,
		`INSERT INTO application_dicts(app_code,app_name) VALUES ('order-service','订单服务')`,
		`INSERT INTO platform_dicts(platform_code,platform_name) VALUES ('ecommerce','电商平台')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	return gormDB
}

func newHost(id, ip, hostname string) *domain.Resource {
	return &domain.Resource{
		ResourceID:      id,
		Category:        domain.CategoryHost,
		TenantID:        "platform_admin",
		NetworkDomainID: "mc-demo",
		Env:             domain.EnvPRD,
		Status:          domain.StatusOnline,
		SourceType:      domain.SourceManual,
		Attributes: domain.HostAttributes{
			Hostname:   hostname,
			InstanceIP: ip,
			OSType:     "linux",
		},
	}
}

func TestRepositoryCreateGetListUpdateDelete(t *testing.T) {
	gormDB := openRepositoryTestDB(t)
	repo := NewGORMRepository(gormDB)
	ctx := context.Background()

	host := newHost("res-1", "10.0.0.1", "web-01")
	require.NoError(t, repo.Create(ctx, host))
	assert.False(t, host.CreatedAt.IsZero(), "create must populate created_at")
	assert.False(t, host.UpdatedAt.IsZero(), "create must populate updated_at")

	got, err := repo.Get(ctx, "res-1")
	require.NoError(t, err)
	assert.Equal(t, domain.CategoryHost, got.Category)
	assert.Equal(t, "host|mc-demo|10.0.0.1", got.DedupKey)
	attrs, ok := got.Attributes.(domain.HostAttributes)
	require.True(t, ok)
	assert.Equal(t, "web-01", attrs.Hostname)

	require.NoError(t, repo.Create(ctx, newHost("res-2", "10.0.0.2", "web-02")))

	list, total, err := repo.List(ctx, ListFilter{Category: domain.CategoryHost, Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)
	assert.Len(t, list, 2)

	list, total, err = repo.List(ctx, ListFilter{Category: domain.CategoryHost, Keyword: "web-01", Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, list, 1)
	assert.Equal(t, "res-1", list[0].ResourceID)

	host.Status = domain.StatusMaintenance
	host.Attributes = domain.HostAttributes{
		Hostname:   "web-01-renamed",
		InstanceIP: "10.0.0.1",
		OSType:     "linux",
	}
	require.NoError(t, repo.Update(ctx, host))

	got, err = repo.Get(ctx, "res-1")
	require.NoError(t, err)
	assert.Equal(t, domain.StatusMaintenance, got.Status)
	attrs, ok = got.Attributes.(domain.HostAttributes)
	require.True(t, ok)
	assert.Equal(t, "web-01-renamed", attrs.Hostname)

	found, ok, err := repo.FindByDedupKey(ctx, domain.CategoryHost, "host|mc-demo|10.0.0.1")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "res-1", found.ResourceID)

	require.NoError(t, repo.SoftDelete(ctx, "res-1"))
	_, err = repo.Get(ctx, "res-1")
	require.Error(t, err)
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)

	list, total, err = repo.List(ctx, ListFilter{Category: domain.CategoryHost, Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	assert.Len(t, list, 1)
}

func TestRepositoryDedupConflict(t *testing.T) {
	gormDB := openRepositoryTestDB(t)
	repo := NewGORMRepository(gormDB)
	ctx := context.Background()

	require.NoError(t, repo.Create(ctx, newHost("res-1", "10.0.0.1", "web-01")))

	err := repo.Create(ctx, newHost("res-2", "10.0.0.1", "web-01-copy"))
	require.Error(t, err)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)
	assert.Equal(t, "host|mc-demo|10.0.0.1", conflict.DedupKey)
}

func TestRepositoryApplicationAttributes(t *testing.T) {
	gormDB := openRepositoryTestDB(t)
	repo := NewGORMRepository(gormDB)
	ctx := context.Background()

	app := &domain.Resource{
		ResourceID:      "app-1",
		Category:        domain.CategoryApplication,
		TenantID:        "platform_admin",
		NetworkDomainID: "mc-demo",
		BizCode:         "payment",
		AppCode:         "order-service",
		PlatformCode:    "ecommerce",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Status:          domain.StatusOnline,
		SourceType:      domain.SourceManual,
		Attributes: domain.ApplicationAttributes{
			ServiceName:    "order-api",
			HealthCheckURL: "https://order.example.com/health",
			Endpoint:       "10.0.0.20",
			Port:           8080,
			Owner1:         "张三",
			Owner1Contact:  "13800000000",
		},
	}
	require.NoError(t, repo.Create(ctx, app))

	got, err := repo.Get(ctx, "app-1")
	require.NoError(t, err)
	assert.Equal(t, "application|mc-demo|order-api|https://order.example.com/health", got.DedupKey)
	attrs, ok := got.Attributes.(domain.ApplicationAttributes)
	require.True(t, ok)
	assert.Equal(t, "order-api", attrs.ServiceName)
	assert.Equal(t, "张三", attrs.Owner1)
	assert.Equal(t, 8080, attrs.Port)
}
