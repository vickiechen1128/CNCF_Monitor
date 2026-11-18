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

type groupResourceReader struct {
	refs map[string]domain.ResourceRef
}

func (r groupResourceReader) ListCandidates(context.Context, domain.CandidateQuery) ([]domain.ResourceRef, int64, error) {
	return nil, 0, nil
}

func (r groupResourceReader) QueryCandidates(_ context.Context, _ domain.CandidateQuery) (domain.CandidatePage, error) {
	return domain.CandidatePage{}, nil
}

func (r groupResourceReader) GetMany(_ context.Context, ids []string) (map[string]domain.ResourceRef, error) {
	out := make(map[string]domain.ResourceRef, len(ids))
	for _, id := range ids {
		if ref, ok := r.refs[id]; ok {
			out[id] = ref
		}
	}
	return out, nil
}

type groupDomainReader struct {
	refs map[string]domain.DomainRef
}

func (r groupDomainReader) Get(_ context.Context, id string) (domain.DomainRef, bool, error) {
	ref, ok := r.refs[id]
	return ref, ok, nil
}

func eligibleDomain(id, name string) domain.DomainRef {
	return domain.DomainRef{
		ID: id, Name: name, Status: "enabled", DomainType: "edge", RegistrationStatus: "monitored",
	}
}

func hostRef(id, domainID string) domain.ResourceRef {
	return domain.ResourceRef{
		ID: id, Category: domain.CategoryHost, NetworkDomainID: domainID, Status: "online",
		InstanceIP: "10.0.0.1",
	}
}

func newGroupTestStack(t *testing.T) (*gorm.DB, *JobGroupService, *JobService) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m01_job_group.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on&_busy_timeout=5000"), &gorm.Config{
		Logger: logger.Discard,
	})
	require.NoError(t, err)
	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-a','域A','edge','platform_admin','enabled')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-b','域B','edge','platform_admin','enabled')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	jobs := repository.NewJobRepository(gormDB)
	groups := repository.NewJobGroupRepository(gormDB)
	resources := groupResourceReader{refs: map[string]domain.ResourceRef{
		"r-a1": hostRef("r-a1", "mc-a"),
		"r-a2": hostRef("r-a2", "mc-a"),
		"r-b1": hostRef("r-b1", "mc-b"),
	}}
	domains := groupDomainReader{refs: map[string]domain.DomainRef{
		"mc-a": eligibleDomain("mc-a", "域A"),
		"mc-b": eligibleDomain("mc-b", "域B"),
	}}
	jobSvc := NewJobService(jobs,
		repository.NewExporterTemplateRepository(gormDB),
		repository.NewMappingRepository(gormDB),
		repository.NewProbeModuleRepository(gormDB),
		repository.NewInstallationRepository(gormDB),
		resources, domains, nil)
	return gormDB, NewJobGroupService(groups, jobSvc, resources, domains), jobSvc
}

func hostGroupInput(ids ...string) JobGroupInput {
	return JobGroupInput{
		Name:                "主机基础采集",
		JobName:             "host-base",
		JobType:             domain.JobTypeStandard,
		ResourceCategory:    domain.CategoryHost,
		MonitorType:         "host_linux",
		SelectedInstanceIDs: ids,
		CreatedBy:           "admin",
	}
}

// 对象优先动线的核心断言：一次提交跨两域实例 → 1 个组 + 每域 1 条子 Job，
// 子 Job 同名（跨域合法）、参数一致、组级状态派生为待同步。
func TestCreateJobGroupFansOutOneChildPerDomain(t *testing.T) {
	gormDB, svc, _ := newGroupTestStack(t)
	ctx := context.Background()

	view, err := svc.Create(ctx, hostGroupInput("r-a1", "r-a2", "r-b1"))
	require.NoError(t, err)

	assert.Equal(t, "主机基础采集", view.Group.Name)
	assert.Equal(t, domain.JobGroupStatusEnabled, view.Group.Status)
	assert.Equal(t, "15s", view.Group.ScrapeInterval, "group keeps the resolved common params")
	require.Len(t, view.Children, 2)

	byDomain := map[string]JobGroupChildView{}
	for _, child := range view.Children {
		byDomain[child.DomainID] = child
		assert.Equal(t, "host-base", child.Job.JobName, "children share one job_name across domains")
		assert.Equal(t, view.Group.ID, child.Job.JobGroupID)
		assert.Equal(t, domain.SyncPending, child.Job.Sync.Status)
		assert.True(t, child.Job.Enabled)
	}
	assert.Equal(t, "域A", byDomain["mc-a"].DomainName)
	assert.Len(t, byDomain["mc-a"].Job.SelectedInstanceIDs, 2)
	assert.Len(t, byDomain["mc-b"].Job.SelectedInstanceIDs, 1)
	assert.Equal(t, "pending", view.Sync.Status)
	assert.Equal(t, 2, view.Sync.Total)

	// 子 Job 落库后仍是单域 Job（M09 直接消费），且同名跨域不冲突
	var count int64
	require.NoError(t, gormDB.Model(&struct{}{}).Table("m01_scrape_jobs").
		Where("job_name = ? AND network_domain_id = ?", "host-base", "mc-a").Count(&count).Error)
	assert.Equal(t, int64(1), count)
	require.NoError(t, gormDB.Table("m01_scrape_jobs").
		Where("job_name = ? AND network_domain_id = ?", "host-base", "mc-b").Count(&count).Error)
	assert.Equal(t, int64(1), count)

	// 组名全局唯一
	_, err = svc.Create(ctx, hostGroupInput("r-a1"))
	var conflict *domain.ConflictError
	require.ErrorAs(t, err, &conflict)
}

// 编辑：改公共参数扇出到全部子 Job；某域实例清零 → 删除该域子 Job（组保留）。
func TestUpdateJobGroupReconcilesChildren(t *testing.T) {
	gormDB, svc, _ := newGroupTestStack(t)
	ctx := context.Background()

	created, err := svc.Create(ctx, hostGroupInput("r-a1", "r-b1"))
	require.NoError(t, err)
	require.Len(t, created.Children, 2)

	next := hostGroupInput("r-a1", "r-a2")
	next.ScrapeInterval = "30s"
	updated, err := svc.Update(ctx, created.Group.ID, next)
	require.NoError(t, err)

	require.Len(t, updated.Children, 1, "the domain with no instance left loses its child job")
	assert.Equal(t, "mc-a", updated.Children[0].DomainID)
	assert.Len(t, updated.Children[0].Job.SelectedInstanceIDs, 2)
	assert.Equal(t, "30s", updated.Children[0].Job.ScrapeInterval, "common params fan out to children")
	assert.Equal(t, "30s", updated.Group.ScrapeInterval)

	var live int64
	require.NoError(t, gormDB.Table("m01_scrape_jobs").
		Where("job_group_id = ? AND deleted_at IS NULL", created.Group.ID).Count(&live).Error)
	assert.Equal(t, int64(1), live, "removed child is soft-deleted, not orphaned")

	// 再把 mc-b 加回来 → 新建该域子 Job，组内仍只有一条同名 Job
	back := hostGroupInput("r-a1", "r-b1")
	back.ScrapeInterval = "30s"
	restored, err := svc.Update(ctx, created.Group.ID, back)
	require.NoError(t, err)
	assert.Len(t, restored.Children, 2)
}

// 删除组 → 组与子 Job 一并软删（级联），不留下孤儿 Job。
func TestDeleteJobGroupCascadesToChildren(t *testing.T) {
	gormDB, svc, _ := newGroupTestStack(t)
	ctx := context.Background()

	created, err := svc.Create(ctx, hostGroupInput("r-a1", "r-b1"))
	require.NoError(t, err)
	require.NoError(t, svc.Delete(ctx, created.Group.ID))

	_, err = svc.Get(ctx, created.Group.ID)
	var notFound *domain.NotFoundError
	require.ErrorAs(t, err, &notFound)

	var live int64
	require.NoError(t, gormDB.Table("m01_scrape_jobs").
		Where("job_group_id = ? AND deleted_at IS NULL", created.Group.ID).Count(&live).Error)
	assert.Equal(t, int64(0), live)
}

// 停用组 → 全部子 Job 停用并回到草稿态，组状态派生为 disabled。
func TestCreateJobGroupDisabledDisablesChildren(t *testing.T) {
	_, svc, _ := newGroupTestStack(t)
	ctx := context.Background()

	input := hostGroupInput("r-a1", "r-b1")
	input.Status = domain.JobGroupStatusDisabled
	view, err := svc.Create(ctx, input)
	require.NoError(t, err)

	assert.Equal(t, "disabled", view.Sync.Status)
	require.Len(t, view.Children, 2)
	for _, child := range view.Children {
		assert.False(t, child.Job.Enabled)
		assert.Equal(t, domain.SyncDraft, child.Job.Sync.Status)
	}
}

// 组级状态派生规则（SRS FR-JG-05）。
func TestDeriveGroupSyncSummary(t *testing.T) {
	job := func(status domain.SyncStatus) *domain.Job {
		return &domain.Job{Sync: domain.SyncState{Status: status}}
	}
	enabled := &domain.JobGroup{Status: domain.JobGroupStatusEnabled}
	disabled := &domain.JobGroup{Status: domain.JobGroupStatusDisabled}

	cases := []struct {
		name     string
		group    *domain.JobGroup
		children []*domain.Job
		want     string
	}{
		{"no children", enabled, nil, "empty"},
		{"all synced", enabled, []*domain.Job{job(domain.SyncSynced), job(domain.SyncSynced)}, "synced"},
		{"some failed", enabled, []*domain.Job{job(domain.SyncSynced), job(domain.SyncFailed)}, "partial"},
		{"all failed", enabled, []*domain.Job{job(domain.SyncFailed), job(domain.SyncFailed)}, "failed"},
		{"pending wins over synced", enabled, []*domain.Job{job(domain.SyncSynced), job(domain.SyncPending)}, "pending"},
		{"all draft", enabled, []*domain.Job{job(domain.SyncDraft), job(domain.SyncDraft)}, "draft"},
		{"disabled group", disabled, []*domain.Job{job(domain.SyncSynced)}, "disabled"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, DeriveGroupSyncSummary(tc.group, tc.children).Status)
		})
	}
}

// SRS JG v1.0 §11：组内子 Job 为受限编辑——只允许改实例；公共参数、凭据、
// 启用态与身份都由组维护，越权修改返回可执行提示；单域 Job 不受影响。
func TestGroupChildJobRestrictedEdit(t *testing.T) {
	_, groupSvc, jobSvc := newGroupTestStack(t)
	ctx := context.Background()

	created, err := groupSvc.Create(ctx, hostGroupInput("r-a1", "r-a2", "r-b1"))
	require.NoError(t, err)
	var child *domain.Job
	for _, item := range created.Children {
		if item.DomainID == "mc-a" {
			child = item.Job
			break
		}
	}
	require.NotNil(t, child)

	// 改公共参数 → 拒绝
	changeInterval := *child
	changeInterval.ScrapeInterval = "60s"
	_, err = jobSvc.Update(ctx, child.ID, &changeInterval, nil, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "managed by the job group")

	// 改凭据 → 拒绝
	changeAuth := *child
	changeAuth.AuthType = domain.AuthBasic
	changeAuth.Username = "probe"
	changeAuth.PasswordCipher = "secret"
	_, err = jobSvc.Update(ctx, child.ID, &changeAuth, nil, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "managed by the job group")

	// 改启用态 → 拒绝
	disabled := false
	_, err = jobSvc.Update(ctx, child.ID, child, &disabled, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "disable the group")

	// 只改实例 → 允许
	onlyInstances := *child
	onlyInstances.SelectedInstanceIDs = []string{"r-a1"}
	view, err := jobSvc.Update(ctx, child.ID, &onlyInstances, nil, false)
	require.NoError(t, err)
	assert.Equal(t, []string{"r-a1"}, view.Job.SelectedInstanceIDs)

	// 直接删子 Job → 拒绝（应通过组编辑或删组）
	require.Error(t, jobSvc.Delete(ctx, child.ID))

	// 回归：单域 Job 仍可正常改参数
	standalone := &domain.Job{
		JobName:             "standalone-host",
		JobType:             domain.JobTypeStandard,
		ResourceCategory:    domain.CategoryHost,
		MonitorType:         "host_linux",
		NetworkDomainID:     "mc-a",
		SelectedInstanceIDs: []string{"r-a1"},
	}
	standaloneView, err := jobSvc.Create(ctx, standalone, nil)
	require.NoError(t, err)
	standaloneView.Job.ScrapeInterval = "45s"
	updated, err := jobSvc.Update(ctx, standaloneView.Job.ID, standaloneView.Job, nil, false)
	require.NoError(t, err)
	assert.Equal(t, "45s", updated.Job.ScrapeInterval)
}
