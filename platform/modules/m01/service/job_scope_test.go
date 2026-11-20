package service

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// SRS JG v1.2 FR-JG-13：租户归属与网域共享授权必须服务端校验（fail-closed），
// 浏览器无法通过构造请求绕过。平台管理员不受限；无 actor（内部调用/兼容）保持原行为。
func TestJobTenantScopeEnforced(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "m01_tenant_scope.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO tenants(id,name,status) VALUES ('tenant-a','租户A','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,authorized_tenant_ids,status)
			VALUES ('mc-a','域A','edge','platform_admin','["platform_admin","tenant-a"]','enabled')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,authorized_tenant_ids,status)
			VALUES ('mc-b','域B','edge','platform_admin','["platform_admin"]','enabled')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	resources := groupResourceReader{refs: map[string]domain.ResourceRef{
		"r-a1": {ID: "r-a1", TenantID: "tenant-a", Category: domain.CategoryHost, NetworkDomainID: "mc-a", Status: "online", InstanceIP: "10.1.0.1"},
		"r-b1": {ID: "r-b1", TenantID: "platform_admin", Category: domain.CategoryHost, NetworkDomainID: "mc-b", Status: "online", InstanceIP: "10.2.0.1"},
		"r-a2": {ID: "r-a2", TenantID: "platform_admin", Category: domain.CategoryHost, NetworkDomainID: "mc-a", Status: "online", InstanceIP: "10.1.0.2"},
	}}
	domains := groupDomainReader{refs: map[string]domain.DomainRef{
		"mc-a": {ID: "mc-a", Name: "域A", Status: "enabled", DomainType: "edge", RegistrationStatus: "monitored",
			TenantID: "platform_admin", AuthorizedTenantIDs: []string{"platform_admin", "tenant-a"}},
		"mc-b": {ID: "mc-b", Name: "域B", Status: "enabled", DomainType: "edge", RegistrationStatus: "monitored",
			TenantID: "platform_admin", AuthorizedTenantIDs: []string{"platform_admin"}},
	}}
	seedNodeTemplate(t, gormDB)
	jobSvc := NewJobService(
		repository.NewJobRepository(gormDB),
		repository.NewExporterTemplateRepository(gormDB),
		newTemplateService(gormDB),
		repository.NewProbeModuleRepository(gormDB),
		repository.NewInstallationRepository(gormDB),
		resources, domains, nil,
	)

	job := func(name, domainID, resourceID string) *domain.Job {
		return &domain.Job{
			JobName: name, JobType: domain.JobTypeStandard,
			ResourceCategory: domain.CategoryHost, TemplateCode: "host_linux",
			NetworkDomainID: domainID, SelectedInstanceIDs: []string{resourceID},
		}
	}
	tenantA := WithActor(context.Background(), Actor{TenantID: "tenant-a"})
	platformAdmin := WithActor(context.Background(), Actor{TenantID: "platform_admin", IsPlatformAdmin: true})

	// 租户 A + 自己的资源 + 被授权的域 → 允许
	_, err = jobSvc.Create(tenantA, job("scope-ok", "mc-a", "r-a1"), nil)
	require.NoError(t, err)

	// 租户 A 在被授权域里选择他租户的资源 → 拒绝（资源归属校验）
	_, err = jobSvc.Create(tenantA, job("scope-x-tenant", "mc-a", "r-a2"), nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "belongs to another tenant")

	// 租户 A 使用未授权网域 → 拒绝
	_, err = jobSvc.Create(tenantA, job("scope-x-domain", "mc-b", "r-b1"), nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not authorized for this tenant")

	// 平台管理员 → 不受限
	_, err = jobSvc.Create(platformAdmin, job("scope-admin", "mc-b", "r-b1"), nil)
	require.NoError(t, err)

	// 无 actor（内部/兼容路径）→ 保持原行为
	_, err = jobSvc.Create(context.Background(), job("scope-legacy", "mc-b", "r-b1"), nil)
	require.NoError(t, err)
}
