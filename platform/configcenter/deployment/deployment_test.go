package deployment

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

func newMemDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:deploy_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.NetworkDomain{},
		&models.ScrapeJob{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
	))
	return db
}

func seedLocalDomain(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	d := &models.NetworkDomain{
		ID:          id,
		Name:        "local-" + id,
		DomainType:  models.DomainTypeManagement,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		Channel:     models.ChannelTypeLocal,
		IsMonitored: true,
	}
	require.NoError(t, db.Create(d).Error)
}

func seedAgentPullDomain(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	d := &models.NetworkDomain{
		ID:          id,
		Name:        "edge-" + id,
		DomainType:  models.DomainTypeEdge,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		Channel:     models.ChannelTypeAgentPull,
		IsMonitored: true,
	}
	require.NoError(t, db.Create(d).Error)
}

func seedVersion(t *testing.T, db *gorm.DB, domainID, changeNo string) *models.ConfigVersion {
	t.Helper()
	targetsJSON, _ := json.Marshal(map[string]string{"node-exporter.json": "[]"})
	v := &models.ConfigVersion{
		NetworkDomainID: domainID,
		DraftID:         "draft-1",
		ChangeNo:        changeNo,
		PrometheusYml:   "global:\n  scrape_interval: 15s\n",
		TargetsFiles:    string(targetsJSON),
	}
	require.NoError(t, db.Create(v).Error)
	return v
}

// seedDeployment persists a deployment row and returns it (auto ID).
func seedDeployment(t *testing.T, db *gorm.DB, domainID string, v *models.ConfigVersion, status models.DeploymentStatus, errMsg string) *models.ConfigDeployment {
	t.Helper()
	dep := &models.ConfigDeployment{
		NetworkDomainID:  domainID,
		ConfigVersionID:  fmt.Sprint(v.ID),
		SourceChangeNo:   v.ChangeNo,
		Channel:          models.ChannelTypeLocal,
		Status:           status,
		ValidationStatus: string(models.ValidationStatusPassed),
		ErrorMessage:     errMsg,
		TriggeredBy:      "admin",
	}
	require.NoError(t, db.Create(dep).Error)
	return dep
}

func idStr(id uint) string { return fmt.Sprint(id) }

func seedJob(t *testing.T, db *gorm.DB, domainID string, changeStatus models.ChangeStatus) *models.ScrapeJob {
	t.Helper()
	j := &models.ScrapeJob{
		JobName:              fmt.Sprintf("job-%s-%s", domainID, changeStatus),
		JobType:              models.JobTypeStandard,
		ResourceType:         models.ResourceTypeHost,
		NetworkDomainID:      domainID,
		InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval:       "15s",
		ScrapeTimeout:        "10s",
		MetricsPath:          "/metrics",
		Scheme:               "http",
		AuthType:             models.AuthTypeNone,
		DraftStatus:          "ready",
		ChangeStatus:         changeStatus,
		Enabled:              true,
	}
	require.NoError(t, db.Create(j).Error)
	return j
}

// seedJobWithDraft 同上，但允许指定 draft_status（用于 MEDIUM-3 过滤断言）。
func seedJobWithDraft(t *testing.T, db *gorm.DB, domainID string, changeStatus models.ChangeStatus, draftStatus string) *models.ScrapeJob {
	t.Helper()
	j := &models.ScrapeJob{
		JobName:               fmt.Sprintf("job-%s-%s-%s", domainID, draftStatus, changeStatus),
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       domainID,
		InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		DraftStatus:           draftStatus,
		ChangeStatus:          changeStatus,
		Enabled:               true,
	}
	require.NoError(t, db.Create(j).Error)
	return j
}

// newMemDBNoJobTable 迁移时不建 ScrapeJob 表，用于模拟 writeback 目标表故障
// （MEDIUM-1 降级路径）。
func newMemDBNoJobTable(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:deploy_nojob_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.NetworkDomain{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
	))
	return db
}

// applyRecorder records Apply calls and can inject an error.
type applyRecorder struct {
	applied int
	err     error
}

func (r *applyRecorder) Apply(*generator.ConfigArtifacts) error {
	r.applied++
	return r.err
}

func TestDispatchLocalSuccessWritesBackChangeStatus(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-001")
	pending := seedJob(t, db, "default", models.ChangeStatusPending)
	seedJob(t, db, "default", models.ChangeStatusNone)

	app := &applyRecorder{}
	dep, err := Dispatch(db, v, "admin", app)
	require.NoError(t, err)
	assert.Equal(t, models.DeploymentStatusSuccess, dep.Status)
	assert.Equal(t, models.ChannelTypeLocal, dep.Channel)
	assert.Equal(t, 1, app.applied)
	assert.NotNil(t, dep.CompletedAt)

	// change_status 回写：pending → deployed；none 不动。
	require.NoError(t, db.First(&pending, pending.ID).Error)
	assert.Equal(t, models.ChangeStatusDeployed, pending.ChangeStatus)
	var noneJob models.ScrapeJob
	require.NoError(t, db.Where("job_name LIKE ?", "%none%").First(&noneJob).Error)
	assert.Equal(t, models.ChangeStatusNone, noneJob.ChangeStatus)
}

func TestDispatchLocalFailureRecordsFailed(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-001")
	pending := seedJob(t, db, "default", models.ChangeStatusPending)

	app := &applyRecorder{err: errors.New("reload failed")}
	dep, err := Dispatch(db, v, "admin", app)
	require.NoError(t, err)
	assert.Equal(t, models.DeploymentStatusFailed, dep.Status)
	assert.Contains(t, dep.ErrorMessage, "reload failed")
	// 失败不回写 change_status。
	require.NoError(t, db.First(&pending, pending.ID).Error)
	assert.Equal(t, models.ChangeStatusPending, pending.ChangeStatus)
}

func TestDispatchAgentPullPlaceholder(t *testing.T) {
	db := newMemDB(t)
	seedAgentPullDomain(t, db, "edge-a")
	v := seedVersion(t, db, "edge-a", "CHG-20240101-001")

	app := &applyRecorder{}
	dep, err := Dispatch(db, v, "admin", app)
	require.NoError(t, err)
	assert.Equal(t, models.DeploymentStatusPending, dep.Status)
	assert.Equal(t, models.ChannelTypeAgentPull, dep.Channel)
	assert.Equal(t, 0, app.applied, "agent_pull 不本地写盘")
}

func TestRetryLocalFailed(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-001")
	// 初始一条 failed 下发。
	orig := seedDeployment(t, db, "default", v, models.DeploymentStatusFailed, "boom")

	app := &applyRecorder{}
	dep, err := Retry(db, idStr(orig.ID), "admin", app)
	require.NoError(t, err)
	assert.Equal(t, models.DeploymentStatusSuccess, dep.Status)
	assert.Equal(t, idStr(v.ID), dep.ConfigVersionID)
	assert.Equal(t, 1, app.applied)

	// 原记录保持 failed。
	require.NoError(t, db.First(&orig, orig.ID).Error)
	assert.Equal(t, models.DeploymentStatusFailed, orig.Status)
}

func TestRetryRejectsNonLocal(t *testing.T) {
	db := newMemDB(t)
	seedAgentPullDomain(t, db, "edge-a")
	v := seedVersion(t, db, "edge-a", "CHG-20240101-001")
	orig := seedDeployment(t, db, "edge-a", v, models.DeploymentStatusFailed, "boom")

	_, err := Retry(db, idStr(orig.ID), "admin", &applyRecorder{})
	assert.ErrorIs(t, err, ErrNotLocal)
}

func TestRetryRejectsNotFailed(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-001")
	orig := seedDeployment(t, db, "default", v, models.DeploymentStatusSuccess, "")

	_, err := Retry(db, idStr(orig.ID), "admin", &applyRecorder{})
	assert.ErrorIs(t, err, ErrNotFailed)
}

func TestRollbackCreatesSuccessDeployment(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-009")
	pending := seedJob(t, db, "default", models.ChangeStatusPending)

	app := &applyRecorder{}
	dep, err := Rollback(db, idStr(v.ID), "admin", app)
	require.NoError(t, err)
	assert.Equal(t, models.DeploymentStatusSuccess, dep.Status)
	assert.Equal(t, idStr(v.ID), dep.ConfigVersionID)
	assert.Equal(t, 1, app.applied)
	// 回滚成功同样回写 change_status。
	require.NoError(t, db.First(&pending, pending.ID).Error)
	assert.Equal(t, models.ChangeStatusDeployed, pending.ChangeStatus)
}

func TestRollbackVersionNotFound(t *testing.T) {
	db := newMemDB(t)
	_, err := Rollback(db, "cv-missing", "admin", &applyRecorder{})
	assert.ErrorIs(t, err, ErrVersionNotFound)
}

// TestDispatchWritebackFailureDegrades 覆盖 MEDIUM-1：writeback 失败不应整链 500，
// 部署仍记 success 并把失败降级记录到 error_message（投递成功与回写解耦）。
func TestDispatchWritebackFailureDegrades(t *testing.T) {
	db := newMemDBNoJobTable(t) // 无 ScrapeJob 表 → writeback 必然失败
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-010")

	app := &applyRecorder{}
	dep, err := Dispatch(db, v, "admin", app)
	require.NoError(t, err, "writeback 失败应降级，不向调用方返回 500")
	assert.Equal(t, models.DeploymentStatusSuccess, dep.Status, "投递已成功，状态应仍为 success")
	assert.Contains(t, dep.ErrorMessage, "writeback", "writeback 失败应记录到 error_message")
	assert.Equal(t, 1, app.applied)
}

// TestWritebackChangeStatusFiltersDraftReady 覆盖 MEDIUM-3：仅回写 draft_status=ready
// 的 pending Job；draft 态 Job 不应被置为 deployed。
func TestWritebackChangeStatusFiltersDraftReady(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-011")
	ready := seedJobWithDraft(t, db, "default", models.ChangeStatusPending, "ready")
	draft := seedJobWithDraft(t, db, "default", models.ChangeStatusPending, "draft")

	_, err := Dispatch(db, v, "admin", &applyRecorder{})
	require.NoError(t, err)

	require.NoError(t, db.First(&ready, ready.ID).Error)
	assert.Equal(t, models.ChangeStatusDeployed, ready.ChangeStatus, "ready 的 pending Job 应回写 deployed")
	require.NoError(t, db.First(&draft, draft.ID).Error)
	assert.Equal(t, models.ChangeStatusPending, draft.ChangeStatus, "draft 态 pending Job 不应被回写")
}

func TestDiskApplierWritesTargetsAndReloadsOnlyOnStructuralChange(t *testing.T) {
	dir := t.TempDir()
	var reloads int32
	app := &DiskApplier{Dir: dir, Reload: func() error {
		atomic.AddInt32(&reloads, 1)
		return nil
	}}

	ca := &generator.ConfigArtifacts{
		PrometheusYML: "global:\n  scrape_interval: 15s\n",
		TargetsFiles:  map[string]string{"node-exporter.json": `[{"targets":["1.2.3.4:9100"]}]`},
	}
	require.NoError(t, app.Apply(ca))
	assert.Equal(t, int32(1), atomic.LoadInt32(&reloads), "首次结构变化触发 reload")

	// 读取写入的 targets 文件。
	content, err := os.ReadFile(filepath.Join(dir, "targets", "node-exporter.json"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "1.2.3.4:9100")
	assert.FileExists(t, filepath.Join(dir, "prometheus.yml"))

	// targets 再变（结构不变）→ 不触发 reload。
	ca2 := &generator.ConfigArtifacts{
		PrometheusYML: "global:\n  scrape_interval: 15s\n",
		TargetsFiles:  map[string]string{"node-exporter.json": `[{"targets":["5.6.7.8:9100"]}]`},
	}
	require.NoError(t, app.Apply(ca2))
	assert.Equal(t, int32(1), atomic.LoadInt32(&reloads), "仅 targets 变化不 reload")
	content, err = os.ReadFile(filepath.Join(dir, "targets", "node-exporter.json"))
	require.NoError(t, err)
	assert.Contains(t, string(content), "5.6.7.8:9100")
}

func TestListAndGetVersion(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	seedVersion(t, db, "default", "CHG-20240101-001")
	seedVersion(t, db, "default", "CHG-20240101-002")

	items, total, err := ListVersions(db, "default", "", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, items, 2)

	items, total, err = ListVersions(db, "default", "CHG-20240101-001", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "CHG-20240101-001", items[0].ChangeNo)

	_, _, err = ListVersions(db, "", "", 1, 20)
	assert.ErrorIs(t, err, ErrDomainRequired)

	// 取一条已种子版本详情。
	var first models.ConfigVersion
	require.NoError(t, db.First(&first).Error)
	v, err := GetVersion(db, idStr(first.ID))
	require.NoError(t, err)
	assert.Equal(t, "default", v.NetworkDomainID)

	_, err = GetVersion(db, "cv-missing")
	assert.ErrorIs(t, err, ErrVersionNotFound)
}

func TestListDeploymentsFilter(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-001")
	seedDeployment(t, db, "default", v, models.DeploymentStatusSuccess, "")
	seedDeployment(t, db, "default", v, models.DeploymentStatusFailed, "err")
	seedDeployment(t, db, "default", v, models.DeploymentStatusSuccess, "")

	items, total, err := ListDeployments(db, "default", "", "", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(3), total)

	items, total, err = ListDeployments(db, "default", "success", "", 1, 20)
	require.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Equal(t, models.DeploymentStatusSuccess, items[0].Status)

	_, _, err = ListDeployments(db, "", "", "", 1, 20)
	assert.ErrorIs(t, err, ErrDomainRequired)
}

func TestDeploymentHandlerRoutes(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	v := seedVersion(t, db, "default", "CHG-20240101-001")
	orig := seedDeployment(t, db, "default", v, models.DeploymentStatusFailed, "")

	old := DefaultApplier
	DefaultApplier = &applyRecorder{}
	t.Cleanup(func() { DefaultApplier = old })

	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/api/v2/platform")
	RegisterRoutes(g, db)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/v2/platform/deployments?network_domain_id=default", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())

	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodPost, "/api/v2/platform/deployments/"+idStr(orig.ID)+"/retry", mustJSON(t, `{"triggered_by":"admin"}`))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 缺少必填网域 → bad_request。
	w = httptest.NewRecorder()
	req, _ = http.NewRequest(http.MethodGet, "/api/v2/platform/deployments", nil)
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
}

// ==== helpers ====

func mustJSON(t *testing.T, s string) *strings.Reader {
	t.Helper()
	return strings.NewReader(s)
}