package references_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

// newCapabilityDB seeds one Linux host with an NPU, one plain Linux host and one
// Windows host. The NPU host is the concrete "one CI, several exporters" case:
// it must match both host_linux (node-exporter) and host_npu (npu-exporter).
func newCapabilityDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormDB := testdb.Open(t)

	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-npu','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.31')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-npu','npu-01','10.0.0.31','Ubuntu',TRUE,FALSE)`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-plain','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.32')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-plain','plain-01','10.0.0.32','CentOS',FALSE,FALSE)`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-win','host','platform_admin','mc-a','PRD','online','manual',0,'host|mc-a|10.0.0.33')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type,has_npu,has_gpu)
			VALUES ('r-win','win-01','10.0.0.33','Windows Server 2019',FALSE,FALSE)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	return gormDB
}

// hostSelector builds the job selector a wizard would save for one host recipe.
func hostSelector(field string, values ...string) domain.Selector {
	return domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
		{Field: field, Operator: domain.RuleOpEq, Values: values},
	}}
}

func candidateIDs(t *testing.T, reader *references.GORMResourceReader, selector domain.Selector) []string {
	t.Helper()
	page, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Category: domain.CategoryHost, Selector: selector, Page: 1, PageSize: 50,
	})
	require.NoError(t, err)
	ids := make([]string, 0, len(page.Refs))
	for _, ref := range page.Refs {
		ids = append(ids, ref.ID)
	}
	return ids
}

// A host carrying an NPU must be selectable by BOTH the OS selector and the NPU
// selector: that is the "one CI, several collectors" requirement (SRS Module_01
// v1.3 FR-23, FR-10). The selectors are the ones stored on the built-in
// host_linux / host_npu templates.
func TestSameHostMatchesOSAndNPUSelectors(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	linuxIDs := candidateIDs(t, reader, hostSelector("os_family", "linux"))
	assert.ElementsMatch(t, []string{"r-npu", "r-plain"}, linuxIDs)

	npuIDs := candidateIDs(t, reader, hostSelector("has_npu", "true"))
	assert.Equal(t, []string{"r-npu"}, npuIDs,
		"only the host with has_npu=true may match the NPU selector")

	winIDs := candidateIDs(t, reader, hostSelector("os_family", "windows"))
	assert.Equal(t, []string{"r-win"}, winIDs)

	// Orthogonality: the NPU host still belongs to the linux candidate set.
	assert.Contains(t, linuxIDs, "r-npu")
}

// A selector is plain data: any dictionary field drives the candidate query
// immediately, with no registry to install or restart (FR-22 / NFR-11).
func TestSelectorDrivesCandidatesWithoutRegistry(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	assert.Equal(t, []string{"r-plain"}, candidateIDs(t, reader, hostSelector("os_type", "CentOS")))

	// OR composition: NPU or GPU hosts.
	anySelector := domain.Selector{Logic: domain.RuleLogicAny, Filters: []domain.ScopeFilter{
		{Field: "has_npu", Operator: domain.RuleOpEq, Values: []string{"true"}},
		{Field: "has_gpu", Operator: domain.RuleOpEq, Values: []string{"true"}},
	}}
	assert.Equal(t, []string{"r-npu"}, candidateIDs(t, reader, anySelector))

	// An empty selector means "the whole category".
	assert.Len(t, candidateIDs(t, reader, domain.Selector{}), 3)
}

// A M07 custom field registered at runtime must be selectable without an M01
// code change or release (NFR-11).
func TestCustomFieldSelectorDrivesCandidates(t *testing.T) {
	gormDB := newCapabilityDB(t)
	for _, stmt := range []string{
		`INSERT INTO m07_attribute_definitions(id,attribute_key,display_name,value_type,resource_category,status)
			VALUES ('attr-asset','asset_no','资产编号','text','host','active')`,
		`INSERT INTO m07_resource_attributes(id,resource_id,attribute_key,value)
			VALUES ('ra-1','r-plain','asset_no','A-1001')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
		if errMsg := ""; errMsg != "" {
			t.Fatal(errMsg)
		}
	}

	reader := references.NewResourceReader(gormDB)
	assert.Equal(t, []string{"r-plain"}, candidateIDs(t, reader, hostSelector("asset_no", "A-1001")))

	// A key that M07 has not registered is still rejected (fail closed).
	_, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Category: domain.CategoryHost, Selector: hostSelector("unregistered_key", "x"), Page: 1, PageSize: 50,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown filter field")
}

// An unknown selector field must fail closed instead of silently returning every
// resource of the category.
func TestUnknownSelectorFieldIsRejected(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	_, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Category: domain.CategoryHost, Selector: hostSelector("1=1 OR r.status", "online"), Page: 1, PageSize: 50,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown filter field")
}

// A selector may only be queried within the category its fields apply to.
func TestCategoryMismatchIsRejected(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	_, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Category: domain.CategoryDatabase, Selector: hostSelector("has_npu", "true"), Page: 1, PageSize: 50,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "does not apply to resource category")
}

// Querying without a category is rejected: the category bounds the candidate
// pool, and a selector alone does not imply it.
func TestCategoryIsRequired(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	_, err := reader.QueryCandidates(context.Background(), domain.CandidateQuery{
		Selector: hostSelector("os_family", "linux"), Page: 1, PageSize: 50,
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "resource_category")
}

func TestCountBySelectorTracksScope(t *testing.T) {
	gormDB := newCapabilityDB(t)
	reader := references.NewResourceReader(gormDB)

	npuCount, err := reader.CountBySelector(context.Background(), domain.CategoryHost, hostSelector("has_npu", "true"))
	require.NoError(t, err)
	assert.Equal(t, int64(1), npuCount)

	linuxCount, err := reader.CountBySelector(context.Background(), domain.CategoryHost, hostSelector("os_family", "linux"))
	require.NoError(t, err)
	assert.Equal(t, int64(2), linuxCount)

	allHosts, err := reader.CountBySelector(context.Background(), domain.CategoryHost, domain.Selector{})
	require.NoError(t, err)
	assert.Equal(t, int64(3), allHosts)
}
