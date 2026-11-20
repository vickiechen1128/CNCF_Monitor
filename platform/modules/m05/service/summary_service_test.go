package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m05/dto"
	"github.com/metriccenter/metriccenter/platform/modules/m05/repository"
)

// fakeSummaryRepo is an in-memory SummaryRepository: the aggregation rules are
// pure and must be verifiable without a database.
type fakeSummaryRepo struct {
	resources         []repository.ResourceRow
	subtypes          map[string]map[string]string
	jobs              []repository.JobRow
	jobCounts         repository.JobCounts
	domainCount       int64
	domains           []repository.DomainRow
	appNames          map[string]string
	bizNames          map[string]string
	platformNames     map[string]string
	cloudNames        map[string]string
	rels              []repository.AppPlatformRelRow
	interfaceServices map[string]repository.ProbeEndpoint
	applications      map[string]repository.ProbeEndpoint
	err               error
}

func (f *fakeSummaryRepo) Resources(context.Context) ([]repository.ResourceRow, error) {
	return f.resources, f.err
}

func (f *fakeSummaryRepo) ResourceSubtypes(_ context.Context, category string) (map[string]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	if byResource, ok := f.subtypes[category]; ok {
		return byResource, nil
	}
	return map[string]string{}, nil
}

func (f *fakeSummaryRepo) ReadyJobs(context.Context) ([]repository.JobRow, error) {
	return f.jobs, f.err
}

func (f *fakeSummaryRepo) ScrapeJobCounts(context.Context) (repository.JobCounts, error) {
	return f.jobCounts, f.err
}

func (f *fakeSummaryRepo) MonitoredDomainCount(context.Context) (int64, error) {
	return f.domainCount, f.err
}

func (f *fakeSummaryRepo) Domains(context.Context) ([]repository.DomainRow, error) {
	return f.domains, f.err
}

func (f *fakeSummaryRepo) AppNames(context.Context) (map[string]string, error) {
	return f.appNames, f.err
}

func (f *fakeSummaryRepo) BizNames(context.Context) (map[string]string, error) {
	return f.bizNames, f.err
}

func (f *fakeSummaryRepo) PlatformNames(context.Context) (map[string]string, error) {
	return f.platformNames, f.err
}

func (f *fakeSummaryRepo) CloudNames(context.Context) (map[string]string, error) {
	return f.cloudNames, f.err
}

func (f *fakeSummaryRepo) AppPlatformRels(context.Context) ([]repository.AppPlatformRelRow, error) {
	return f.rels, f.err
}

func (f *fakeSummaryRepo) InterfaceServices(context.Context, []string) (map[string]repository.ProbeEndpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.interfaceServices, nil
}

func (f *fakeSummaryRepo) Applications(context.Context, []string) (map[string]repository.ProbeEndpoint, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.applications, nil
}

// fakeUpHealthQuerier returns a fixed index or error.
type fakeUpHealthQuerier struct {
	index *domain.UpHealthIndex
	err   error
}

func (f fakeUpHealthQuerier) UpHealth(context.Context) (*domain.UpHealthIndex, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.index, nil
}

// emptySummaryRepo is the "fresh v3 database" read model.
func emptySummaryRepo() *fakeSummaryRepo {
	return &fakeSummaryRepo{
		subtypes:          map[string]map[string]string{},
		appNames:          map[string]string{},
		bizNames:          map[string]string{},
		platformNames:     map[string]string{},
		cloudNames:        map[string]string{},
		interfaceServices: map[string]repository.ProbeEndpoint{},
		applications:      map[string]repository.ProbeEndpoint{},
	}
}

// TestBuildSummaryEmptyDatabase asserts the empty-library contract: every slice
// field is [] (never nil) and collection_health is omitted without a querier.
func TestBuildSummaryEmptyDatabase(t *testing.T) {
	svc := NewSummaryService(emptySummaryRepo(), nil)

	summary, err := svc.Build(context.Background())
	require.NoError(t, err)

	assert.Equal(t, 0, summary.ResourceCount)
	assert.Equal(t, 0, summary.MonitoredCount)
	assert.Equal(t, 0, summary.ScrapeJobCount)
	assert.Equal(t, 0, summary.ScrapeJobEnabledCount)
	assert.Equal(t, 0, summary.DomainCount)

	assert.NotNil(t, summary.ByCategory)
	assert.Len(t, summary.ByCategory, 6, "six fixed categories even on an empty database")
	assert.NotNil(t, summary.ByApp)
	assert.Empty(t, summary.ByApp)
	assert.NotNil(t, summary.ProbeTargets)
	assert.Empty(t, summary.ProbeTargets)
	assert.NotNil(t, summary.ByPlatformApp)
	assert.Empty(t, summary.ByPlatformApp)
	assert.NotNil(t, summary.ByCloud)
	assert.Empty(t, summary.ByCloud)
	assert.Nil(t, summary.CollectionHealth, "no Prometheus configured must omit the field, not report zero")
	assert.Equal(t, 0, summary.ProbeTargetAbnormalCount)

	// Category order is contract (frontend renders positionally), and each
	// empty category still exposes an empty (non-nil) by_subtype array.
	wantOrder := []string{"host", "database", "middleware", "application", "generic_target", "interface_service"}
	for i, category := range summary.ByCategory {
		assert.Equal(t, wantOrder[i], category.ResourceCategory)
		assert.Equal(t, 0, category.ResourceCount)
		assert.Equal(t, 0, category.MonitoredCount)
		assert.NotNil(t, category.BySubtype)
		assert.Empty(t, category.BySubtype)
	}
}

// buildRicherSummaryRepo returns a mixed read model: four subtype categories,
// classified / unclassified apps, cloud + platform attribution and two
// blackbox targets.
func richerSummaryRepo() *fakeSummaryRepo {
	repo := emptySummaryRepo()
	repo.resources = []repository.ResourceRow{
		{ResourceID: "host-1", ResourceCategory: "host", AppCode: "order", BizCode: "payment", PlatformCode: "ecommerce", NetworkDomainID: "dom-1"},
		{ResourceID: "host-2", ResourceCategory: "host", NetworkDomainID: "dom-2"},
		{ResourceID: "db-1", ResourceCategory: "database", AppCode: "order", BizCode: "payment"},
		{ResourceID: "mw-1", ResourceCategory: "middleware", AppCode: "cache", BizCode: "infra"},
		{ResourceID: "gt-1", ResourceCategory: "generic_target", AppCode: "snmp"},
		{ResourceID: "app-1", ResourceCategory: "application", AppCode: "order", PlatformCode: "ecommerce"},
		{ResourceID: "if-1", ResourceCategory: "interface_service", AppCode: "iface"},
	}
	repo.subtypes = map[string]map[string]string{
		"host":           {"host-1": "linux", "host-2": "windows"},
		"database":       {"db-1": "mysql"},
		"middleware":     {"mw-1": "redis"},
		"generic_target": {"gt-1": "snmp"},
	}
	repo.jobs = []repository.JobRow{
		{ID: "job-1", JobType: "standard", SelectedInstanceIDs: []byte(`["host-1","db-1","ghost"]`)},
		{ID: "job-2", JobType: "blackbox", NetworkDomainID: "dom-1", SelectedInstanceIDs: []byte(`["if-1","app-1"]`)},
	}
	repo.jobCounts = repository.JobCounts{Total: 4, Enabled: 3}
	repo.domainCount = 2
	repo.domains = []repository.DomainRow{
		{ID: "dom-1", Name: "生产采集域", CloudCode: "PUB-TX"},
		{ID: "dom-2", Name: "未登记云域"},
	}
	repo.appNames = map[string]string{"order": "订单服务"}
	repo.bizNames = map[string]string{"payment": "支付业务"}
	repo.platformNames = map[string]string{"ecommerce": "电商平台"}
	repo.cloudNames = map[string]string{"PUB-TX": "腾讯云"}
	repo.rels = []repository.AppPlatformRelRow{
		{AppCode: "order", PlatformCode: "ecommerce"},
		{AppCode: "order", PlatformCode: "payment-platform"},
	}
	repo.interfaceServices = map[string]repository.ProbeEndpoint{
		"if-1": {Name: "订单查询接口", URL: "https://api.example.com/orders"},
	}
	repo.applications = map[string]repository.ProbeEndpoint{
		"app-1": {URL: "https://app.example.com/health"},
	}
	return repo
}

// TestBuildSummaryAggregates is the core v3 aggregate contract test.
func TestBuildSummaryAggregates(t *testing.T) {
	svc := NewSummaryService(richerSummaryRepo(), nil)

	summary, err := svc.Build(context.Background())
	require.NoError(t, err)

	assert.Equal(t, 7, summary.ResourceCount)
	// host-1 / db-1 (standard job) + if-1 / app-1 (blackbox job); "ghost" does
	// not exist in resources and "host-2" is not selected.
	assert.Equal(t, 4, summary.MonitoredCount)
	assert.Equal(t, 4, summary.ScrapeJobCount)
	assert.Equal(t, 3, summary.ScrapeJobEnabledCount)
	assert.Equal(t, 2, summary.DomainCount)

	// —— by_category：六类固定 + 按类子类 ——
	byCategory := make(map[string]struct {
		resource  int
		monitored int
		subtypes  map[string][2]int
	}, len(summary.ByCategory))
	for _, category := range summary.ByCategory {
		bucket := struct {
			resource  int
			monitored int
			subtypes  map[string][2]int
		}{resource: category.ResourceCount, monitored: category.MonitoredCount, subtypes: map[string][2]int{}}
		for _, subtype := range category.BySubtype {
			bucket.subtypes[subtype.Subtype] = [2]int{subtype.ResourceCount, subtype.MonitoredCount}
		}
		byCategory[category.ResourceCategory] = bucket
	}
	assert.Equal(t, 2, byCategory["host"].resource)
	assert.Equal(t, 1, byCategory["host"].monitored)
	assert.Equal(t, [2]int{1, 1}, byCategory["host"].subtypes["linux"])
	assert.Equal(t, [2]int{1, 0}, byCategory["host"].subtypes["windows"])
	assert.Equal(t, [2]int{1, 1}, byCategory["database"].subtypes["mysql"])
	assert.Equal(t, [2]int{1, 0}, byCategory["middleware"].subtypes["redis"])
	assert.Equal(t, [2]int{1, 0}, byCategory["generic_target"].subtypes["snmp"])
	assert.Empty(t, byCategory["application"].subtypes, "application has no subtype axis")
	assert.Empty(t, byCategory["interface_service"].subtypes, "interface_service has no subtype axis")

	// —— by_app / unclassified ——
	byApp := make(map[string]appRow, len(summary.ByApp))
	for _, app := range summary.ByApp {
		byApp[app.AppCode] = appRow{name: app.AppName, bizCode: app.BizCode, bizName: app.BizName,
			resource: app.ResourceCount, monitored: app.MonitoredCount}
	}
	assert.Equal(t, appRow{name: "订单服务", bizCode: "payment", bizName: "支付业务", resource: 3, monitored: 3}, byApp["order"])
	assert.Equal(t, "cache", byApp["cache"].name, "missing dictionary entry falls back to the code")
	assert.Equal(t, "infra", byApp["cache"].bizCode)
	assert.Equal(t, "infra", byApp["cache"].bizName, "missing business dictionary falls back to the code")
	assert.Equal(t, 1, summary.UnclassifiedResourceCount, "only host-2 has no app_code")
	assert.Equal(t, 0, summary.UnclassifiedMonitoredCount)

	// —— by_cloud：host only，未指定云行恒在末位 ——
	require.Len(t, summary.ByCloud, 2)
	assert.Equal(t, "PUB-TX", summary.ByCloud[0].CloudCode)
	assert.Equal(t, "腾讯云", summary.ByCloud[0].CloudName)
	assert.Equal(t, 1, summary.ByCloud[0].ResourceCount)
	assert.Equal(t, 1, summary.ByCloud[0].MonitoredCount)
	assert.Equal(t, 100, summary.ByCloud[0].CoverageRate)
	assert.Equal(t, "", summary.ByCloud[1].CloudCode)
	assert.Equal(t, "未指定云", summary.ByCloud[1].CloudName)
	assert.Equal(t, 1, summary.ByCloud[1].ResourceCount)
	assert.Equal(t, 0, summary.ByCloud[1].MonitoredCount)
	assert.Equal(t, 0, summary.ByCloud[1].CoverageRate)

	// —— by_platform_app：host only，「未指定平台」行在末位 ——
	require.Len(t, summary.ByPlatformApp, 2)
	assert.Equal(t, "ecommerce", summary.ByPlatformApp[0].PlatformCode)
	assert.Equal(t, "电商平台", summary.ByPlatformApp[0].PlatformName)
	require.Len(t, summary.ByPlatformApp[0].Cells, 1)
	assert.Equal(t, "order", summary.ByPlatformApp[0].Cells[0].AppCode)
	assert.Equal(t, "订单服务", summary.ByPlatformApp[0].Cells[0].AppName)
	assert.Equal(t, 1, summary.ByPlatformApp[0].HostCount)
	assert.Equal(t, "", summary.ByPlatformApp[1].PlatformCode)
	assert.Equal(t, "未指定平台", summary.ByPlatformApp[1].PlatformName)
	assert.Equal(t, "未指定应用", summary.ByPlatformApp[1].Cells[0].AppName)
	assert.Equal(t, 1, summary.ByPlatformApp[1].HostCount)

	// —— probe_targets：仅 blackbox 选中的存活资源；status 未知、last_probe_at nil ——
	require.Equal(t, 2, summary.ProbeTargetCount)
	require.Len(t, summary.ProbeTargets, 2)
	assert.Equal(t, 0, summary.ProbeTargetAbnormalCount)

	iface := summary.ProbeTargets[0]
	assert.Equal(t, "interface_service", iface.ResourceCategory)
	assert.Equal(t, "https://api.example.com/orders", iface.URL)
	assert.Equal(t, "订单查询接口", iface.ServiceName)
	assert.Equal(t, "", iface.PlatformNames, "interface services carry no platform")
	assert.Equal(t, "dom-1", iface.NetworkDomainID)
	assert.Equal(t, "生产采集域", iface.NetworkDomainName)
	assert.Equal(t, "", iface.Status)
	assert.Nil(t, iface.LastProbeAt)

	app := summary.ProbeTargets[1]
	assert.Equal(t, "application", app.ResourceCategory)
	assert.Equal(t, "https://app.example.com/health", app.URL)
	assert.Equal(t, "订单服务", app.ServiceName, "application targets show the dictionary name")
	assert.Equal(t, "payment-platform、电商平台", app.PlatformNames, "M:N platforms joined and sorted")
	assert.Equal(t, "", app.Status)
	assert.Nil(t, app.LastProbeAt)
}

// appRow is the by_app projection used by the assertions above.
type appRow struct {
	name      string
	bizCode   string
	bizName   string
	resource  int
	monitored int
}

// TestBuildSummaryPlatformTopNAndOther covers the「Top 4 + 其他 + 未指定平台」rule and
// the total-preserving invariant.
func TestBuildSummaryPlatformTopNAndOther(t *testing.T) {
	repo := emptySummaryRepo()
	// p1 hosts 5, p2 4, p3 3, p4 2, p5 1, p6 1, plus 2 unassigned.
	plan := map[string]int{"p1": 5, "p2": 4, "p3": 3, "p4": 2, "p5": 1, "p6": 1, "": 2}
	for platform, hosts := range plan {
		for i := 0; i < hosts; i++ {
			repo.resources = append(repo.resources, repository.ResourceRow{
				ResourceID:       platform + "-host-" + string(rune('a'+i)),
				ResourceCategory: "host",
				PlatformCode:     platform,
				AppCode:          "order",
			})
		}
	}

	svc := NewSummaryService(repo, nil)
	summary, err := svc.Build(context.Background())
	require.NoError(t, err)

	require.Len(t, summary.ByPlatformApp, 6, "top 4 + 其他 + 未指定平台")
	wantCodes := []string{"p1", "p2", "p3", "p4", platformAppOtherCode, ""}
	total := 0
	for i, row := range summary.ByPlatformApp {
		assert.Equal(t, wantCodes[i], row.PlatformCode)
		total += row.HostCount
		assert.Equal(t, row.HostCount, sumCells(row.Cells), "row total equals cell sum")
	}
	assert.Equal(t, 18, total, "收敛只改呈现粒度，不改合计")
	assert.Equal(t, "其他", summary.ByPlatformApp[4].PlatformName)
	assert.Equal(t, 2, summary.ByPlatformApp[4].HostCount)
	assert.Equal(t, "未指定平台", summary.ByPlatformApp[5].PlatformName)
	assert.Equal(t, 2, summary.ByPlatformApp[5].HostCount)
	assert.Equal(t, 5, summary.ByPlatformApp[0].HostCount)
}

// sumCells adds the host counts of one matrix row (row total === cell sum).
func sumCells(cells []dto.PlatformAppCell) int {
	total := 0
	for _, cell := range cells {
		total += cell.HostCount
	}
	return total
}

// TestBuildSummaryCollectionHealth covers the three-state classification and the
// degrade path (query error ⇒ field omitted).
func TestBuildSummaryCollectionHealth(t *testing.T) {
	repo := emptySummaryRepo()
	repo.resources = []repository.ResourceRow{
		{ResourceID: "r1", ResourceCategory: "host"},
		{ResourceID: "r2", ResourceCategory: "host"},
		{ResourceID: "r3", ResourceCategory: "host"},
		{ResourceID: "r4", ResourceCategory: "host"},
	}
	repo.jobs = []repository.JobRow{
		{ID: "job-1", JobType: "standard", SelectedInstanceIDs: []byte(`["r1","r2","r3","r4"]`)},
	}
	index := domain.NewUpHealthIndex(
		map[string]bool{"r1": true, "r2": true},
		map[string]bool{"r2": true, "r3": true},
	)
	svc := NewSummaryService(repo, fakeUpHealthQuerier{index: index})

	summary, err := svc.Build(context.Background())
	require.NoError(t, err)
	require.NotNil(t, summary.CollectionHealth)
	assert.Equal(t, 4, summary.CollectionHealth.DispatchedCount)
	assert.Equal(t, 1, summary.CollectionHealth.CollectingCount)
	assert.Equal(t, 1, summary.CollectionHealth.PartialCollectingCount)
	assert.Equal(t, 2, summary.CollectionHealth.DownCount)
	assert.Equal(t,
		summary.CollectionHealth.DispatchedCount,
		summary.CollectionHealth.CollectingCount+summary.CollectionHealth.PartialCollectingCount+summary.CollectionHealth.DownCount,
		"the three states must add up to the dispatched denominator")

	// Query failure degrades to nil (the frontend renders "unavailable").
	svc = NewSummaryService(repo, fakeUpHealthQuerier{err: errors.New("prometheus down")})
	summary, err = svc.Build(context.Background())
	require.NoError(t, err)
	assert.Nil(t, summary.CollectionHealth, "a failed Prom query must not be reported as zero")
}

// TestBuildSummaryMonitoredIntersectionWithLiveResources proves soft-deleted
// resources stop counting as monitored.
func TestBuildSummaryMonitoredIntersectionWithLiveResources(t *testing.T) {
	repo := emptySummaryRepo()
	repo.resources = []repository.ResourceRow{
		{ResourceID: "live", ResourceCategory: "host"},
	}
	repo.jobs = []repository.JobRow{
		{ID: "job-1", JobType: "standard", SelectedInstanceIDs: []byte(`["live","deleted"]`)},
	}

	summary, err := NewSummaryService(repo, nil).Build(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, summary.ResourceCount)
	assert.Equal(t, 1, summary.MonitoredCount, "only the live selected resource counts")
	require.Len(t, summary.ByCategory, 6)
	assert.Equal(t, 1, summary.ByCategory[0].MonitoredCount)
}

// TestBuildSummaryRejectsBrokenSelectedIDs surfaces corrupt m01 JSON instead of
// silently under-counting the monitored set.
func TestBuildSummaryRejectsBrokenSelectedIDs(t *testing.T) {
	repo := emptySummaryRepo()
	repo.jobs = []repository.JobRow{
		{ID: "job-1", JobType: "standard", SelectedInstanceIDs: []byte(`["unterminated`)},
	}

	_, err := NewSummaryService(repo, nil).Build(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "job-1")
}

// TestBuildSummaryRepositoryError propagates read failures.
func TestBuildSummaryRepositoryError(t *testing.T) {
	repo := emptySummaryRepo()
	repo.err = errors.New("db unavailable")

	_, err := NewSummaryService(repo, nil).Build(context.Background())
	require.Error(t, err)
}

// TestBuildSummaryBizMajorityTieBreak keeps the v2 tie-break rule (smaller biz
// code wins) so the payload stays deterministic.
func TestBuildSummaryBizMajorityTieBreak(t *testing.T) {
	repo := emptySummaryRepo()
	repo.resources = []repository.ResourceRow{
		{ResourceID: "r1", ResourceCategory: "host", AppCode: "order", BizCode: "beta"},
		{ResourceID: "r2", ResourceCategory: "host", AppCode: "order", BizCode: "alpha"},
		{ResourceID: "r3", ResourceCategory: "host", AppCode: "order", BizCode: "alpha"},
		{ResourceID: "r4", ResourceCategory: "host", AppCode: "order", BizCode: "gamma"},
		{ResourceID: "r5", ResourceCategory: "host", AppCode: "order", BizCode: "gamma"},
	}

	summary, err := NewSummaryService(repo, nil).Build(context.Background())
	require.NoError(t, err)
	require.Len(t, summary.ByApp, 1)
	assert.Equal(t, "alpha", summary.ByApp[0].BizCode, "majority wins")
	assert.Equal(t, "alpha", summary.ByApp[0].BizName, "unknown biz name falls back to the code")
}

// TestBuildSummaryProbeTargetsSkipUnusableRows documents the v2-compatible skip
// rules: unknown category, missing extension row and empty address are dropped.
func TestBuildSummaryProbeTargetsSkipUnusableRows(t *testing.T) {
	repo := emptySummaryRepo()
	repo.resources = []repository.ResourceRow{
		{ResourceID: "host-1", ResourceCategory: "host"},
		{ResourceID: "if-1", ResourceCategory: "interface_service"},
		{ResourceID: "app-1", ResourceCategory: "application"},
		{ResourceID: "if-empty", ResourceCategory: "interface_service"},
	}
	repo.jobs = []repository.JobRow{
		{ID: "job-1", JobType: "blackbox", NetworkDomainID: "dom-missing",
			SelectedInstanceIDs: []byte(`["host-1","if-1","app-1","if-empty","deleted"]`)},
	}
	repo.interfaceServices = map[string]repository.ProbeEndpoint{
		"if-1":     {Name: "接口", URL: "https://api.example.com/x"},
		"if-empty": {Name: "空地址", URL: ""},
	}

	summary, err := NewSummaryService(repo, nil).Build(context.Background())
	require.NoError(t, err)
	require.Equal(t, 1, summary.ProbeTargetCount, "only the usable interface service survives")
	assert.Equal(t, "https://api.example.com/x", summary.ProbeTargets[0].URL)
	assert.Equal(t, "dom-missing", summary.ProbeTargets[0].NetworkDomainName,
		"missing domain falls back to the domain id")
}
