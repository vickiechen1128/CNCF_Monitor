package references_test

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
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
)

func newCandidateDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m01_candidates.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-ubuntu','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.21')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-ubuntu','ubuntu-01','10.0.0.21','Ubuntu')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-rhel','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.23')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-rhel','rhel-01','10.0.0.23','RedHat Enterprise Linux')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-win','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.22')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-win','win-01','10.0.0.22','Windows Server 2019')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	return gormDB
}

// 回归：os_type 存的是字典规范名（Ubuntu / RedHat Enterprise Linux …），
// host_linux 的 DefaultSelector（os_family = linux）在候选查询里必须按 OS 字典
// 关键字做大小写不敏感子串匹配，而不是写死 'linux'
// （否则真实主机永远选不到，2026-11-17 线上库复现）。
func TestQueryCandidatesMatchesCanonicalOSTypes(t *testing.T) {
	gormDB := newCandidateDB(t)
	reader := references.NewResourceReader(gormDB)

	page, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Category: domain.CategoryHost, Selector: linuxSelector(), Page: 1, PageSize: 50,
	})
	require.NoError(t, err)

	ids := make([]string, 0, len(page.Refs))
	for _, ref := range page.Refs {
		ids = append(ids, ref.ID)
	}
	assert.Contains(t, ids, "r-ubuntu", "canonical Ubuntu os_type must match host_linux")
	assert.Contains(t, ids, "r-rhel", "RedHat Enterprise Linux must match host_linux")
	assert.NotContains(t, ids, "r-win", "Windows hosts must not match host_linux")

	windows, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Category: domain.CategoryHost, Selector: windowsSelector(), Page: 1, PageSize: 50,
	})
	require.NoError(t, err)
	winIDs := make([]string, 0, len(windows.Refs))
	for _, ref := range windows.Refs {
		winIDs = append(winIDs, ref.ID)
	}
	assert.Equal(t, []string{"r-win"}, winIDs)
}

// linuxSelector / windowsSelector reproduce the DefaultSelector a job inherits
// from the built-in host_linux / host_windows collection templates.
func linuxSelector() domain.Selector {
	return domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
		{Field: "os_family", Operator: domain.RuleOpEq, Values: []string{"linux"}},
	}}
}

func windowsSelector() domain.Selector {
	return domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
		{Field: "os_family", Operator: domain.RuleOpEq, Values: []string{"windows"}},
	}}
}
