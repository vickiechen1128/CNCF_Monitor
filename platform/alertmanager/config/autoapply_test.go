package config

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/deployment"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// --- 自动闭环（dev-feedback §25 方案 A）测试 ---

// stubAutoApply 替换自动闭环 seam autoApplyManagementDomain：记录调用次数与 uploader，
// 并令其返回 errVal。t.Cleanup 恢复被替换的实现（风格同 stubChangeTrigger）。
func stubAutoApply(t *testing.T, errVal error) (*int32, *string) {
	t.Helper()
	orig := autoApplyManagementDomain
	var calls int32
	var by string
	autoApplyManagementDomain = func(db *gorm.DB, b string) error {
		atomic.AddInt32(&calls, 1)
		by = b
		return errVal
	}
	t.Cleanup(func() { autoApplyManagementDomain = orig })
	return &calls, &by
}

// TestSubmitTriggersAutoApplyManagementDomain 验证 Submit 在校验通过、落库、触发 M09
// 变更检测之后，会对管理域触发一次自动闭环工序（透传 uploadedBy）。
func TestSubmitTriggersAutoApplyManagementDomain(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	calls, by := stubAutoApply(t, nil)

	v, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	require.NotNil(t, v)
	assert.EqualValues(t, 1, atomic.LoadInt32(calls), "Submit 应触发一次管理域自动闭环")
	assert.Equal(t, "chenrt", *by)
}

// TestSubmitDegradesWhenAutoApplyFails 覆盖降级语义：自动闭环失败不得让 M08 submit 报错
// （配置收录已成功），返回哨兵 errAutoApply，且版本已落库、v 非 nil、不 panic。
func TestSubmitDegradesWhenAutoApplyFails(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	calls, _ := stubAutoApply(t, errors.New("confirm boom"))

	v, err := Submit(db, validAMConfig, "chenrt")
	require.Error(t, err)
	assert.ErrorIs(t, err, errAutoApply)
	require.NotNil(t, v, "降级时仍须返回已留痕版本")
	assert.NotZero(t, v.ID)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, v.Status)
	assert.EqualValues(t, 1, atomic.LoadInt32(calls))

	// 收录未回滚。
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

// TestRemountAlsoTriggersAutoApply 验证 Remount 经同一工序 submitValidated，同样触发自动闭环。
func TestRemountAlsoTriggersAutoApply(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	calls, by := stubAutoApply(t, nil)

	v, err := Remount(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	require.NotNil(t, v)
	assert.EqualValues(t, 1, atomic.LoadInt32(calls))
	assert.Equal(t, "chenrt", *by)
}

// TestSubmitAutoApplyFailureHandlerLogsNot500 覆盖 handler 侧降级：自动闭环失败时 Submit
// 返回非 nil 版本 + 哨兵错误，handler 记日志并返回 200（不得落 500），契约「不阻断挂载」。
func TestSubmitAutoApplyFailureHandlerLogsNot500(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	stubAutoApply(t, errors.New("confirm boom"))
	r := newConfigRouter(db)

	body := `{"content":"` + strings.ReplaceAll(validAMConfig, "\n", "\\n") + `","uploaded_by":"chenrt"}`
	w := do(t, r, http.MethodPost, "/api/v2/platform/alertmanager/config", body)
	assert.Equal(t, http.StatusOK, w.Code, w.Body.String())
}

// --- 真实工序 applyManagementDomainConfig（在可控校验通过的边界内）测试 ---

// newAutoApplyDB 建一个迁移了草稿/下发全链路所需表的 sqlite 内存库。
func newAutoApplyDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:amauto_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ScrapeJob{},
		&models.MonitoringRule{},
		&models.LabelTemplate{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.CITypeExporterMapping{},
		&models.ExporterInstallationConfirmation{},
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
		&models.ConfigChangeBaseline{},
		&models.AlertmanagerConfigVersion{},
		&models.NotifyChannel{},
		&models.NotifyTemplate{},
		&models.EdgeAgent{},
	))
	return db
}

// stubGeneratorTools 注入 generator 外部校验工具（promtool / blackbox / amtool 视作可用且
// 通过），使草稿校验落到 passed，从而 ConfirmDraft 可通过（不依赖真实外部二进制）。
func stubGeneratorTools(t *testing.T) {
	t.Helper()
	oldLook := generator.ToolLookPath
	oldChecker := generator.ToolChecker
	generator.ToolLookPath = func(name string) (string, error) { return name, nil }
	generator.ToolChecker = func(ca *generator.ConfigArtifacts, ib bool) (generator.ToolCheckStatus, string) {
		return generator.ToolCheckPassed, ""
	}
	t.Cleanup(func() { generator.ToolLookPath = oldLook; generator.ToolChecker = oldChecker })
}

// deploymentRecorder 记录 DefaultApplier 的 Apply 调用次数（复用 deployment_test.go 口径）。
type deploymentRecorder struct{ applied int }

func (r *deploymentRecorder) Apply(*generator.ConfigArtifacts) error {
	r.applied++
	return nil
}

// seedAMMgmtDomain 造中心管理域（local 通道，is_monitored，enabled）。
func seedAMMgmtDomain(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          id,
		Name:        "管理域-" + id,
		DomainType:  models.DomainTypeManagement,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		ZoneType:    "intranet",
		Channel:     models.ChannelTypeLocal,
		IsMonitored: true,
	}).Error)
}

// seedAMHost 造一台在线主机资源（供 targets 解析）。
func seedAMHost(t *testing.T, db *gorm.DB, domainID, resourceID string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       resourceID,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domainID,
		BizCode:          "biz",
		PrivateIP:        "10.0.0.1",
		InstanceName:     "host-" + resourceID,
		Status:           "online",
		Region:           "cn-east",
		ZoneEnv:          "prod",
		InstanceSpec:     "4c8g",
		Image:            "Ubuntu",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		SourceType:       models.SourceTypeManual,
	}).Error)
}

// seedAMJob 造一条 enabled + ready 的采集 Job（产生变更项，避免 ErrNoChanges 抑制）。
func seedAMJob(t *testing.T, db *gorm.DB, domainID, name string) {
	t.Helper()
	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName:               name,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       domainID,
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   []string{"res-1"},
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		Enabled:               true,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusPending,
	}).Error)
}

// TestApplyManagementDomainConfigNoChangesReturnsNil 覆盖 ErrNoChanges 路径：管理域存在
// 但无实质变更（无 ready job/rule）时，工序视为无需下发、返回 nil、不产生草稿、不 panic。
func TestApplyManagementDomainConfigNoChangesReturnsNil(t *testing.T) {
	db := newAutoApplyDB(t)
	seedAMMgmtDomain(t, db, managementDomainID)
	seedAMHost(t, db, managementDomainID, "res-1") // 有源数据、但无 ready job/rule
	stubGeneratorTools(t)

	require.NoError(t, applyManagementDomainConfig(db, "chenrt"))

	var drafts int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).Count(&drafts).Error)
	assert.EqualValues(t, 0, drafts, "ErrNoChanges 不得生成空变更单")
}

// TestSubmitAutoAppliesManagementDomainEndToEnd 端到端覆盖用例 1：Submit 一份合法 content
// 后，管理域 default 产生一条 confirmed 草稿 + 一条对应 ConfigVersion，DefaultApplier 被
// 调用一次（alertmanager.yml 落盘 + reload 由真实链路驱动），且写盘成功后 applied_at 回填。
func TestSubmitAutoAppliesManagementDomainEndToEnd(t *testing.T) {
	db := newAutoApplyDB(t)
	seedAMMgmtDomain(t, db, managementDomainID)
	seedAMHost(t, db, managementDomainID, "res-1")
	seedAMJob(t, db, managementDomainID, "am-job")
	stubAmtoolAvailable(t)
	stubGeneratorTools(t)

	// change trigger 短路（避免依赖 M09 基线/轮询表），auto-apply 走真实 seam。
	origTrigger := triggerChangeDetection
	triggerChangeDetection = func(db *gorm.DB) error { return nil }
	t.Cleanup(func() { triggerChangeDetection = origTrigger })

	rec := &deploymentRecorder{}
	origApplier := deployment.DefaultApplier
	deployment.DefaultApplier = rec
	t.Cleanup(func() { deployment.DefaultApplier = origApplier })

	v, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err, "自动闭环应端到端成功（校验已 stub 通过）")
	require.NotNil(t, v)

	// default 域产生一条 confirmed 草稿。
	var confirmed int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ? AND status = ?", managementDomainID, models.DraftStatusConfirmed).
		Count(&confirmed).Error)
	assert.EqualValues(t, 1, confirmed, "应为管理域产生一条已确认草稿")

	// 对应一条 ConfigVersion。
	var versions int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).Count(&versions).Error)
	assert.EqualValues(t, 1, versions)

	// 参与真实下发：DefaultApplier 被调用一次（写 alertmanager.yml + AM reload）。
	assert.Equal(t, 1, rec.applied)

	// 写盘成功后 applied_at 回填（真实生效信号，契约 §5.1 / dev-feedback §25）。
	var got models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&got, v.ID).Error)
	require.NotNil(t, got.AppliedAt, "下发成功后应回填 applied_at")
}
