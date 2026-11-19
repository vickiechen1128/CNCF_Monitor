package service

import (
	"context"
	"errors"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m07/repository"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type fakeRepository struct {
	resources map[string]*domain.Resource
	conflict  bool
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{resources: map[string]*domain.Resource{}}
}

func (f *fakeRepository) Create(_ context.Context, resource *domain.Resource) error {
	if f.conflict {
		return &domain.ConflictError{DedupKey: resource.DedupKey}
	}
	f.resources[resource.ResourceID] = resource
	return nil
}

func (f *fakeRepository) Get(_ context.Context, resourceID string) (*domain.Resource, error) {
	resource, ok := f.resources[resourceID]
	if !ok {
		return nil, &domain.NotFoundError{ResourceID: resourceID}
	}
	return resource, nil
}

func (f *fakeRepository) List(_ context.Context, _ repository.ListFilter) ([]*domain.Resource, int64, error) {
	out := make([]*domain.Resource, 0, len(f.resources))
	for _, resource := range f.resources {
		out = append(out, resource)
	}
	return out, int64(len(out)), nil
}

func (f *fakeRepository) Update(_ context.Context, resource *domain.Resource) error {
	if _, ok := f.resources[resource.ResourceID]; !ok {
		return &domain.NotFoundError{ResourceID: resource.ResourceID}
	}
	f.resources[resource.ResourceID] = resource
	return nil
}

func (f *fakeRepository) SoftDelete(_ context.Context, resourceID string) error {
	if _, ok := f.resources[resourceID]; !ok {
		return &domain.NotFoundError{ResourceID: resourceID}
	}
	delete(f.resources, resourceID)
	return nil
}

func (f *fakeRepository) FindByDedupKey(_ context.Context, _ string, category domain.Category, dedupKey string) (*domain.Resource, bool, error) {
	for _, resource := range f.resources {
		if resource.Category == category && resource.DedupKey == dedupKey {
			return resource, true, nil
		}
	}
	return nil, false, nil
}

func (f *fakeRepository) GetMany(_ context.Context, resourceIDs []string) ([]*domain.Resource, error) {
	out := make([]*domain.Resource, 0, len(resourceIDs))
	for _, id := range resourceIDs {
		if resource, ok := f.resources[id]; ok {
			out = append(out, resource)
		}
	}
	return out, nil
}

func (f *fakeRepository) BulkReassign(_ context.Context, input repository.BulkReassignInput) (int64, error) {
	var affected int64
	for _, id := range input.ResourceIDs {
		resource, ok := f.resources[id]
		if !ok {
			continue
		}
		switch input.Field {
		case ReassignFieldBizCode:
			resource.BizCode = input.TargetCode
		case ReassignFieldAppCode:
			resource.AppCode = input.TargetCode
			if resource.Category.IsComposed() && input.DerivedPlatformCode != "" {
				resource.PlatformCode = input.DerivedPlatformCode
			}
		case ReassignFieldPlatformCode:
			resource.PlatformCode = input.TargetCode
		}
		affected++
	}
	return affected, nil
}

func (f *fakeRepository) BulkSetScrapePort(_ context.Context, resourceIDs []string, scrapePort int) (int64, error) {
	var affected int64
	for _, id := range resourceIDs {
		resource, ok := f.resources[id]
		if !ok {
			continue
		}
		resource.ScrapePort = scrapePort
		affected++
	}
	return affected, nil
}

type fakeDictionary struct {
	primary   string
	err       error
	targetErr error
	belongs   map[string]bool
}

func (f *fakeDictionary) ValidateResource(_ context.Context, _ *domain.Resource) error {
	return f.err
}

func (f *fakeDictionary) ValidateResourceUpdate(_ context.Context, _, _ *domain.Resource) error {
	return f.err
}

func (f *fakeDictionary) PrimaryPlatformOfApp(_ context.Context, _ string) (string, bool, error) {
	if f.primary == "" {
		return "", false, nil
	}
	return f.primary, true, nil
}

func (f *fakeDictionary) PlatformBelongsToApp(_ context.Context, appCode, platformCode string) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	return f.belongs[appCode+"|"+platformCode], nil
}

func (f *fakeDictionary) ValidateReferenceTarget(_ context.Context, _, _ string) error {
	return f.targetErr
}

func applicationResource() *domain.Resource {
	return &domain.Resource{
		Category:        domain.CategoryApplication,
		NetworkDomainID: "mc-demo",
		BizCode:         "payment",
		AppCode:         "order-service",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Attributes: domain.ApplicationAttributes{
			ServiceName:    "order-api",
			HealthCheckURL: "https://order.example.com/health",
		},
	}
}

func TestCreateDefaultsAndPlatformFallback(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	resource, err := svc.Create(context.Background(), applicationResource())
	require.NoError(t, err)

	assert.NotEmpty(t, resource.ResourceID)
	assert.Equal(t, DefaultTenantID, resource.TenantID)
	assert.Equal(t, domain.SourceManual, resource.SourceType)
	assert.Equal(t, domain.StatusOnline, resource.Status)
	assert.Equal(t, "ecommerce", resource.PlatformCode)
	assert.Equal(t, "application|mc-demo|order-api|https://order.example.com/health", resource.DedupKey)
}

func TestCreateConflict(t *testing.T) {
	repo := newFakeRepository()
	repo.conflict = true
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	_, err := svc.Create(context.Background(), applicationResource())
	require.Error(t, err)
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)
}

func TestUpdatePreservesImmutableFields(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	created, err := svc.Create(context.Background(), applicationResource())
	require.NoError(t, err)

	input := applicationResource()
	input.Category = domain.CategoryHost
	_, err = svc.Update(context.Background(), created.ResourceID, input)
	require.ErrorContains(t, err, "immutable")

	input = applicationResource()
	input.Status = domain.StatusMaintenance
	input.PlatformCode = ""
	updated, err := svc.Update(context.Background(), created.ResourceID, input)
	require.NoError(t, err)
	assert.Equal(t, created.ResourceID, updated.ResourceID)
	assert.Equal(t, created.TenantID, updated.TenantID)
	assert.Equal(t, created.SourceType, updated.SourceType)
	assert.Equal(t, domain.StatusMaintenance, updated.Status)
	assert.Equal(t, "ecommerce", updated.PlatformCode)
}

func TestDeleteNotFound(t *testing.T) {
	svc := NewResourceService(newFakeRepository(), &fakeDictionary{})
	err := svc.Delete(context.Background(), "missing")
	require.Error(t, err)
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)
}

// D43：组成型资源的平台归属恒由所属应用的主平台派生——即便请求体显式带了
// 一个不同的 platform_code，也必须被覆盖，避免手填值与应用归属不一致。
func TestComposedResourceAlwaysDerivesPrimaryPlatform(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	input := applicationResource()
	input.PlatformCode = "hand-typed-wrong-platform"

	resource, err := svc.Create(context.Background(), input)
	require.NoError(t, err)
	assert.Equal(t, "ecommerce", resource.PlatformCode, "组成型资源应忽略显式输入，恒取应用主平台")

	// 更新路径同理：清空或改写都不影响派生结果。
	update := applicationResource()
	update.PlatformCode = "another-wrong-platform"
	updated, err := svc.Update(context.Background(), resource.ResourceID, update)
	require.NoError(t, err)
	assert.Equal(t, "ecommerce", updated.PlatformCode)
}

// D43：静态资源保留显式 platform_code；仅当为空时才回落到应用主平台。
func TestStaticResourceKeepsExplicitPlatform(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	explicit := staticHostResource()
	explicit.PlatformCode = "lab"
	created, err := svc.Create(context.Background(), explicit)
	require.NoError(t, err)
	assert.Equal(t, "lab", created.PlatformCode, "静态资源显式填写的平台优先")

	fallback := staticHostResource()
	fallback.Attributes = domain.HostAttributes{
		Hostname:   "host-2",
		OSType:     "linux",
		InstanceIP: "10.0.0.12",
	}
	fallback.PlatformCode = ""
	createdFallback, err := svc.Create(context.Background(), fallback)
	require.NoError(t, err)
	assert.Equal(t, "ecommerce", createdFallback.PlatformCode, "留空时按应用主平台兜底")
}

func staticHostResource() *domain.Resource {
	return &domain.Resource{
		Category:        domain.CategoryHost,
		NetworkDomainID: "mc-demo",
		AppCode:         "order-service",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Attributes: domain.HostAttributes{
			Hostname:   "host-1",
			OSType:     "linux",
			InstanceIP: "10.0.0.11",
		},
	}
}

// M07 SRS v2.0 FR-28：批量改业务归属——去重后整批成功，返回实际更新数。
func TestBulkReassignBizCode(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	host := staticHostResource()
	created, err := svc.Create(context.Background(), host)
	require.NoError(t, err)
	second := staticHostResource()
	second.Attributes = domain.HostAttributes{Hostname: "host-2", OSType: "linux", InstanceIP: "10.0.0.12"}
	other, err := svc.Create(context.Background(), second)
	require.NoError(t, err)

	result, err := svc.BulkReassign(context.Background(),
		[]string{created.ResourceID, other.ResourceID, created.ResourceID},
		ReassignFieldBizCode, "payment")
	require.NoError(t, err)
	assert.Equal(t, 2, result.UpdatedCount)
	assert.Equal(t, "payment", repo.resources[created.ResourceID].BizCode)
	assert.Equal(t, "payment", repo.resources[other.ResourceID].BizCode)
}

// FR-28：组成型资源不允许直接改平台；整批拒绝且不产生部分写入。
func TestBulkReassignRejectsComposedPlatformChange(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})

	created, err := svc.Create(context.Background(), applicationResource())
	require.NoError(t, err)

	_, err = svc.BulkReassign(context.Background(), []string{created.ResourceID}, ReassignFieldPlatformCode, "lab")
	var bulkErr *BulkReassignError
	require.ErrorAs(t, err, &bulkErr)
	require.Len(t, bulkErr.Failures, 1)
	assert.Contains(t, bulkErr.Failures[0].Reason, "组成型资源")
	assert.Equal(t, "ecommerce", repo.resources[created.ResourceID].PlatformCode, "整批失败不得产生部分写入")
}

// FR-28 / D43：改应用归属时，组成型资源的平台跟随目标应用主平台派生。
func TestBulkReassignAppCodeDerivesComposedPlatform(t *testing.T) {
	repo := newFakeRepository()
	dict := &fakeDictionary{primary: "ecommerce"}
	svc := NewResourceService(repo, dict)

	created, err := svc.Create(context.Background(), applicationResource())
	require.NoError(t, err)
	assert.Equal(t, "ecommerce", created.PlatformCode)

	dict.primary = "warehouse"
	result, err := svc.BulkReassign(context.Background(), []string{created.ResourceID}, ReassignFieldAppCode, "inventory")
	require.NoError(t, err)
	assert.Equal(t, 1, result.UpdatedCount)
	assert.Equal(t, "inventory", repo.resources[created.ResourceID].AppCode)
	assert.Equal(t, "warehouse", repo.resources[created.ResourceID].PlatformCode,
		"组成型资源平台必须随目标应用主平台重新派生")
}

// FR-28：静态资源的显式平台必须已关联目标应用，否则整批拒绝并给出原因。
func TestBulkReassignRejectsUnassociatedStaticPlatform(t *testing.T) {
	repo := newFakeRepository()
	dict := &fakeDictionary{primary: "ecommerce", belongs: map[string]bool{}}
	svc := NewResourceService(repo, dict)

	host := staticHostResource()
	host.PlatformCode = "lab"
	created, err := svc.Create(context.Background(), host)
	require.NoError(t, err)

	_, err = svc.BulkReassign(context.Background(), []string{created.ResourceID}, ReassignFieldAppCode, "inventory")
	var bulkErr *BulkReassignError
	require.ErrorAs(t, err, &bulkErr)
	assert.Contains(t, bulkErr.Failures[0].Reason, "未关联目标应用")
	assert.Equal(t, "order-service", repo.resources[created.ResourceID].AppCode)
}

// FR-28：静态资源显式平台必须已关联其应用归属，批量改平台不得绕过该不变量。
func TestBulkReassignRejectsUnassociatedPlatform(t *testing.T) {
	repo := newFakeRepository()
	dict := &fakeDictionary{primary: "ecommerce", belongs: map[string]bool{}}
	svc := NewResourceService(repo, dict)

	host := staticHostResource()
	host.PlatformCode = "lab"
	created, err := svc.Create(context.Background(), host)
	require.NoError(t, err)
	require.Equal(t, "lab", repo.resources[created.ResourceID].PlatformCode)

	_, err = svc.BulkReassign(context.Background(), []string{created.ResourceID}, ReassignFieldPlatformCode, "warehouse")
	var bulkErr *BulkReassignError
	require.ErrorAs(t, err, &bulkErr)
	assert.Contains(t, bulkErr.Failures[0].Reason, "未关联目标平台")
	assert.Equal(t, "lab", repo.resources[created.ResourceID].PlatformCode, "整批失败不得产生部分写入")

	// 应用↔平台关联建立后同一批次放行。
	dict.belongs["order-service|warehouse"] = true
	result, err := svc.BulkReassign(context.Background(), []string{created.ResourceID}, ReassignFieldPlatformCode, "warehouse")
	require.NoError(t, err)
	assert.Equal(t, 1, result.UpdatedCount)
	assert.Equal(t, "warehouse", repo.resources[created.ResourceID].PlatformCode)
}

// FR-28：目标必须启用、字段必须受支持；缺失资源以失败明细返回。
func TestBulkReassignValidation(t *testing.T) {
	repo := newFakeRepository()
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce", targetErr: errors.New("target disabled")})
	ctx := context.Background()

	_, err := svc.BulkReassign(ctx, nil, ReassignFieldBizCode, "payment")
	require.ErrorContains(t, err, "resource_ids")

	_, err = svc.BulkReassign(ctx, []string{"res-1"}, "owner", "payment")
	require.ErrorContains(t, err, "field")

	_, err = svc.BulkReassign(ctx, []string{"res-1"}, ReassignFieldBizCode, "")
	require.ErrorContains(t, err, "target_code")

	_, err = svc.BulkReassign(ctx, []string{"res-1"}, ReassignFieldBizCode, "disabled-entry")
	require.ErrorContains(t, err, "target disabled")

	dict := &fakeDictionary{primary: "ecommerce"}
	svc = NewResourceService(repo, dict)
	_, err = svc.BulkReassign(ctx, []string{"missing"}, ReassignFieldBizCode, "payment")
	var bulkErr *BulkReassignError
	require.ErrorAs(t, err, &bulkErr)
	assert.Equal(t, "missing", bulkErr.Failures[0].ResourceID)
}

type recordedChangeNotifier struct {
	domainCalls [][]string
	allCalls    int
}

func (n *recordedChangeNotifier) ResourceChanged(_ context.Context, domainIDs ...string) {
	n.domainCalls = append(n.domainCalls, append([]string(nil), domainIDs...))
}

func (n *recordedChangeNotifier) AllResourcesChanged(context.Context) {
	n.allCalls++
}

func TestResourceWritesNotifyConfigSync(t *testing.T) {
	repo := newFakeRepository()
	notifier := &recordedChangeNotifier{}
	svc := NewResourceService(repo, &fakeDictionary{primary: "ecommerce"})
	svc.SetChangeNotifier(notifier)

	host := staticHostResource()
	created, err := svc.Create(context.Background(), host)
	require.NoError(t, err)
	require.Len(t, notifier.domainCalls, 1)
	assert.Equal(t, []string{"mc-demo"}, notifier.domainCalls[0])

	require.NoError(t, svc.Delete(context.Background(), created.ResourceID))
	require.Len(t, notifier.domainCalls, 2)
	assert.Equal(t, []string{"mc-demo"}, notifier.domainCalls[1])

	_, err = svc.BulkSetScrapePort(context.Background(), []string{created.ResourceID}, 9200)
	require.NoError(t, err)
	assert.Equal(t, 1, notifier.allCalls, "bulk port changes notify all domains")
}
