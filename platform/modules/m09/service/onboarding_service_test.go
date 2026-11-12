package service_test

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

func kindOf(err error) apierror.Kind { return apierror.KindOf(err) }

func newTestStack(t *testing.T) (*gorm.DB, *service.OnboardingService, *repository.GORMRepository) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m09_onboarding.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		NetworkDomainIDs: []string{"mc-a", "mc-b", "mc-disabled"},
		IsPlatformAdmin:  true, Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", NetworkDomainIDs: []string{"mc-a"},
		Status: models.TenantStatusActive,
	}).Error)

	createDomain(t, gormDB, "mc-a", models.DomainStatusEnabled)
	createDomain(t, gormDB, "mc-b", models.DomainStatusEnabled)
	createDomain(t, gormDB, "mc-disabled", models.DomainStatusDisabled)

	repo := repository.NewGORMRepository(gormDB)
	svc := service.NewOnboardingService(repo, repo)
	return gormDB, svc, repo
}

func createDomain(t *testing.T, gormDB *gorm.DB, id string, status models.DomainStatus) {
	t.Helper()
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: id, Name: "域 " + id, Description: "描述 " + id, DomainType: models.DomainTypeEdge,
		ZoneType: "beijing", CloudCode: "aliyun",
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Channel:             models.ChannelTypeAgentPull,
		Status:              status,
	}).Error)
}

func admin() service.Actor {
	return service.Actor{TenantID: models.PlatformAdminTenantID, IsPlatformAdmin: true}
}

func TestMonitorIssuesTokenOnce(t *testing.T) {
	gormDB, svc, repo := newTestStack(t)
	ctx := context.Background()

	result, err := svc.Monitor(ctx, admin(), "mc-a", service.Endpoint{
		CenterEndpoint: "https://mc.example.com",
		RemoteWriteURL: "https://mc.example.com/api/v1/write",
	})
	require.NoError(t, err)
	assert.Equal(t, "monitored", result.RegistrationState)
	require.NotEmpty(t, result.TokenPlain)
	assert.Contains(t, result.TokenPlain, "mctok_v1_")
	assert.NotEmpty(t, result.TokenMasked)
	assert.NotContains(t, result.TokenMasked, result.TokenPlain)
	assert.Equal(t, "https://mc.example.com", result.CenterEndpoint)
	assert.NotEmpty(t, result.InstallGuide.Steps)
	assert.Equal(t, "/api/v3/platform/edge-packages/latest", result.InstallGuide.PackageDownloadURL)

	access, err := repo.FindAccess(ctx, "mc-a")
	require.NoError(t, err)
	require.NotNil(t, access)
	assert.Equal(t, domain.RegistrationStatusMonitored, access.RegistrationStatus)
	assert.Equal(t, domain.HashToken(result.TokenPlain), access.TokenHash, "only the hash is stored")
	assert.NotEqual(t, result.TokenPlain, access.TokenHash, "plaintext never persisted")
	assert.True(t, domain.TokenMatches(result.TokenPlain, access.TokenHash))
	assert.NotNil(t, access.MonitoredAt)

	var rawCount int64
	require.NoError(t, gormDB.Model(&models.NetworkDomain{}).Where("token = ?", result.TokenPlain).Count(&rawCount).Error)
	assert.Zero(t, rawCount, "legacy network_domains.token must not hold the v3 token")
}

func TestMonitorRejectsDuplicateAndDisabled(t *testing.T) {
	_, svc, _ := newTestStack(t)
	ctx := context.Background()

	_, err := svc.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	_, err = svc.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	assert.Equal(t, "conflict", string(kindOf(err)))

	_, err = svc.Monitor(ctx, admin(), "mc-disabled", service.Endpoint{})
	assert.Equal(t, "bad_request", string(kindOf(err)))

	_, err = svc.Monitor(ctx, admin(), "missing", service.Endpoint{})
	assert.Equal(t, "not_found", string(kindOf(err)))
}

func TestResetTokenRevokesOld(t *testing.T) {
	_, svc, repo := newTestStack(t)
	ctx := context.Background()

	first, err := svc.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	reset, err := svc.ResetToken(ctx, admin(), "mc-a")
	require.NoError(t, err)
	assert.NotEqual(t, first.TokenPlain, reset.TokenPlain)

	access, err := repo.FindAccess(ctx, "mc-a")
	require.NoError(t, err)
	assert.True(t, domain.TokenMatches(reset.TokenPlain, access.TokenHash))
	assert.False(t, domain.TokenMatches(first.TokenPlain, access.TokenHash), "old token must fail immediately")

	_, err = svc.ResetToken(ctx, admin(), "mc-b")
	assert.Equal(t, "conflict", string(kindOf(err)), "resetting a non-monitored domain is a conflict")
}

func TestUnmonitorIsIdempotent(t *testing.T) {
	_, svc, repo := newTestStack(t)
	ctx := context.Background()

	first, err := svc.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	require.NoError(t, svc.Unmonitor(ctx, admin(), "mc-a"))
	access, err := repo.FindAccess(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, domain.RegistrationStatusCreated, access.RegistrationStatus)
	assert.Empty(t, access.TokenHash)
	assert.False(t, domain.TokenMatches(first.TokenPlain, access.TokenHash))

	require.NoError(t, svc.Unmonitor(ctx, admin(), "mc-a"), "unmonitor is idempotent")
}

func TestListScopesNonAdminAndAggregatesAgents(t *testing.T) {
	gormDB, svc, _ := newTestStack(t)
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(`INSERT INTO edge_agents (network_domain_id, hostname, status)
		VALUES ('mc-a','node-1','online')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO edge_agents (network_domain_id, hostname, status)
		VALUES ('mc-a','node-2','offline')`).Error)

	adminItems, total, err := svc.List(ctx, admin(), repository.ListFilter{Page: 1, PageSize: 50})
	require.NoError(t, err)
	assert.EqualValues(t, 2, total, "enabled edge domains only (mc-disabled excluded)")
	byID := map[string]repository.DomainOnboarding{}
	for _, item := range adminItems {
		byID[item.DomainID] = item
	}
	require.Contains(t, byID, "mc-a")
	assert.EqualValues(t, 2, byID["mc-a"].AgentCount)
	assert.EqualValues(t, 1, byID["mc-a"].OnlineAgentCount)
	assert.Equal(t, "created", byID["mc-a"].RegistrationStatus)

	tenantItems, total, err := svc.List(ctx, service.Actor{TenantID: "tenant-a"}, repository.ListFilter{Page: 1, PageSize: 50})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, tenantItems, 1)
	assert.Equal(t, "mc-a", tenantItems[0].DomainID)

	_, err = svc.Get(ctx, service.Actor{TenantID: "tenant-a"}, "mc-b")
	assert.Equal(t, "not_found", string(kindOf(err)), "unauthorized detail is 404")
}

func TestListAdminViewIncludesDisabledWithAdminFields(t *testing.T) {
	gormDB, svc, _ := newTestStack(t)
	ctx := context.Background()
	require.NoError(t, gormDB.Model(&models.NetworkDomain{}).Where("id = ?", "mc-disabled").
		Update("description", "停用域的说明").Error)

	items, total, err := svc.List(ctx, admin(), repository.ListFilter{
		View: service.ViewAdmin, Status: "disabled", Page: 1, PageSize: 50,
	})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	item := items[0]
	assert.Equal(t, "mc-disabled", item.DomainID)
	assert.Equal(t, "disabled", item.AdminStatus)
	assert.Equal(t, "edge", item.AdminDomainType)
	assert.Equal(t, "停用域的说明", item.Description)
	assert.Equal(t, models.PlatformAdminTenantID, item.TenantID)
	assert.Equal(t, []string{models.PlatformAdminTenantID}, item.AuthorizedTenantIDs)

	// The default onboarding view still hides disabled domains.
	_, total, err = svc.List(ctx, admin(), repository.ListFilter{Page: 1, PageSize: 50})
	require.NoError(t, err)
	assert.EqualValues(t, 2, total)

	// Non-admins cannot request the administrative view.
	_, _, err = svc.List(ctx, service.Actor{TenantID: "tenant-a"}, repository.ListFilter{
		View: service.ViewAdmin, Page: 1, PageSize: 50,
	})
	assert.Equal(t, "forbidden", string(kindOf(err)))

	// An explicit status also implies the administrative view.
	_, _, err = svc.List(ctx, service.Actor{TenantID: "tenant-a"}, repository.ListFilter{
		Status: "disabled", Page: 1, PageSize: 50,
	})
	assert.Equal(t, "forbidden", string(kindOf(err)))
}

func TestMonitoringRetirerCascades(t *testing.T) {
	gormDB, svc, repo := newTestStack(t)
	ctx := context.Background()

	_, err := svc.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)
	require.NoError(t, gormDB.Exec(`INSERT INTO edge_agents (network_domain_id, hostname, status)
		VALUES ('mc-a','node-1','online')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO edge_agents (network_domain_id, hostname, status)
		VALUES ('mc-a','node-2','offline')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO edge_target_snapshots
		(network_domain_id, job, instance, last_report_at) VALUES ('mc-a','node','10.0.0.1:9100',?)`,
		time.Now().UTC()).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO domain_config_snapshots
		(network_domain_id, version, checksum, is_current) VALUES ('mc-a','v1','sha256:x',1)`).Error)

	assert.True(t, svc.Available())
	impact, err := svc.Impact(ctx, "mc-a")
	require.NoError(t, err)
	assert.EqualValues(t, 2, impact.ManagedEdgeAgentCount)
	assert.True(t, impact.HasOnlineAgents)

	require.NoError(t, svc.RetireDomain(ctx, "mc-a"))
	require.NoError(t, svc.RetireDomain(ctx, "mc-a"), "retirement is idempotent")

	access, err := repo.FindAccess(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, domain.RegistrationStatusRetired, access.RegistrationStatus)
	assert.Empty(t, access.TokenHash)

	var agentStatuses []string
	require.NoError(t, gormDB.Raw(`SELECT status FROM edge_agents WHERE network_domain_id = 'mc-a'`).
		Scan(&agentStatuses).Error)
	require.Len(t, agentStatuses, 2)
	for _, status := range agentStatuses {
		assert.Equal(t, "retired", status)
	}

	var targets, snapshots int64
	require.NoError(t, gormDB.Table("edge_target_snapshots").
		Where("network_domain_id = ?", "mc-a").Count(&targets).Error)
	require.NoError(t, gormDB.Table("domain_config_snapshots").
		Where("network_domain_id = ?", "mc-a").Count(&snapshots).Error)
	assert.Zero(t, targets, "target snapshots are cleared")
	assert.Zero(t, snapshots, "config snapshots are cleared")

	impact, err = svc.Impact(ctx, "mc-a")
	require.NoError(t, err)
	assert.Zero(t, impact.ManagedEdgeAgentCount, "retired agents drop out of the impact count")
}
