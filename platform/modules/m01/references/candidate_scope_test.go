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

// newCapabilityDB seeds one Linux host with an NPU, one plain Linux host and one
// Windows host. The NPU host is the concrete "one CI, several exporters" case:
// it must match both host_linux (node-exporter) and host_npu (npu-exporter).
func newCapabilityDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m01_capability.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-npu','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.31')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-npu','npu-01','10.0.0.31','Ubuntu',1,0)`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-plain','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.32')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-plain','plain-01','10.0.0.32','CentOS',0,0)`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-win','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.33')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-win','win-01','10.0.0.33','Windows Server 2019',0,0)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	return gormDB
}

func candidateIDs(t *testing.T, reader *references.GORMResourceReader, monitorType string) []string {
	t.Helper()
	page, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		MonitorType: monitorType, Page: 1, PageSize: 50,
	})
	require.NoError(t, err)
	ids := make([]string, 0, len(page.Refs))
	for _, ref := range page.Refs {
		ids = append(ids, ref.ID)
	}
	return ids
}

// A host carrying an NPU must be selectable by BOTH the OS type and the NPU
// type: that is the "one CI, multiple collectors" requirement (SRS Module_01
// v1.3 FR-23, FR-10).
func TestSameHostMatchesOSAndNPUTypes(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	linuxIDs := candidateIDs(t, reader, domain.MonitorTypeHostLinux)
	assert.ElementsMatch(t, []string{"r-npu", "r-plain"}, linuxIDs)

	npuIDs := candidateIDs(t, reader, domain.MonitorTypeHostNPU)
	assert.Equal(t, []string{"r-npu"}, npuIDs,
		"only the host with has_npu=true may match the NPU type")

	winIDs := candidateIDs(t, reader, domain.MonitorTypeHostWindows)
	assert.Equal(t, []string{"r-win"}, winIDs)

	// Orthogonality: the NPU host still belongs to host_linux.
	assert.Contains(t, linuxIDs, "r-npu")
}

// A type registered at runtime (no code change) must drive the candidate query
// immediately (FR-21 / NFR-11).
func TestRuntimeRegisteredTypeDrivesCandidates(t *testing.T) {
	gormDB := newCapabilityDB(t)

	custom := domain.MonitorTypeEntry{
		Definition: domain.MonitorTypeDefinition{
			Code:             "host_centos",
			Name:             "CentOS 主机",
			ResourceCategory: domain.CategoryHost,
			RuleLogic:        domain.RuleLogicAll,
			Enabled:          true,
		},
		Rules: []domain.MonitorTypeRule{{
			Field: "os_type", Operator: domain.RuleOpEq, Values: []string{"CentOS"},
		}},
	}
	entries := append(domain.BuiltinMonitorTypeEntries(), custom)
	domain.InstallMonitorTypeRegistry(domain.NewMonitorTypeRegistry(entries))
	t.Cleanup(domain.ResetMonitorTypeRegistry)

	reader := references.NewResourceReader(gormDB)
	assert.Equal(t, []string{"r-plain"}, candidateIDs(t, reader, "host_centos"))
}

// An unknown monitor type must fail closed instead of silently returning every
// resource of the category.
func TestUnknownMonitorTypeIsRejected(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	_, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		MonitorType: "does_not_exist", Page: 1, PageSize: 50,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown monitor type")
}

// A type may only be queried within its own resource category.
func TestCategoryMismatchIsRejected(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	_, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		MonitorType: domain.MonitorTypeHostNPU,
		Category:    domain.CategoryDatabase,
		Page:        1, PageSize: 50,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "belongs to resource category")
}

func TestCountCandidatesTracksScope(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	npuCount, err := reader.CountCandidates(context.Background(), domain.MonitorTypeHostNPU)
	require.NoError(t, err)
	assert.Equal(t, int64(1), npuCount)

	linuxCount, err := reader.CountCandidates(context.Background(), domain.MonitorTypeHostLinux)
	require.NoError(t, err)
	assert.Equal(t, int64(2), linuxCount)
}
