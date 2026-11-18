package config

import (
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

// newMemConfigDB opens a per-test in-memory SQLite DB migrated with the
// alertmanager config version table and the management domain (alertmanager.yml
// belongs to the center-direct domain, decision 60).
func newMemConfigDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:amcfg_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.AlertmanagerConfigVersion{}, &models.NetworkDomain{}))
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:                  models.DefaultDomainID,
		Name:                "默认网域",
		DomainType:          models.DomainTypeManagement,
		Channel:             models.ChannelTypeLocal,
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Status:              models.DomainStatusEnabled,
		IsMonitored:         true,
	}).Error)
	return db
}

// stubAmtoolAvailable 令任意 content 的 amtool 校验通过。
func stubAmtoolAvailable(t *testing.T) {
	t.Helper()
	origLook := lookPathAmtool
	origRun := runAmtoolCheckCmd
	lookPathAmtool = func(name string) (string, error) { return "amtool", nil }
	runAmtoolCheckCmd = func(amtool, cfgPath string) (string, error) { return "Checking 'alertmanager.yml'\nSUCCESS\n", nil }
	t.Cleanup(func() {
		lookPathAmtool = origLook
		runAmtoolCheckCmd = origRun
	})
}

// stubAmtoolFails 令 amtool 校验失败（返回行级错误输出）。
func stubAmtoolFails(t *testing.T) {
	t.Helper()
	origLook := lookPathAmtool
	origRun := runAmtoolCheckCmd
	lookPathAmtool = func(name string) (string, error) { return "amtool", nil }
	runAmtoolCheckCmd = func(amtool, cfgPath string) (string, error) {
		return "Checking 'alertmanager.yml'\nalertmanager.yml:14: unknown receiver \"sre-critical\" referenced by route\nFAILED\n", nil
	}
	t.Cleanup(func() {
		lookPathAmtool = origLook
		runAmtoolCheckCmd = origRun
	})
}

// stubAmtoolUnavailable 令 amtool 不可调用（不在 PATH）。
func stubAmtoolUnavailable(t *testing.T) {
	t.Helper()
	origLook := lookPathAmtool
	origRun := runAmtoolCheckCmd
	lookPathAmtool = func(name string) (string, error) { return "", errors.New("executable not found") }
	runAmtoolCheckCmd = func(amtool, cfgPath string) (string, error) { return "", errors.New("should not run") }
	t.Cleanup(func() {
		lookPathAmtool = origLook
		runAmtoolCheckCmd = origRun
	})
}

// stubChangeTrigger 记录触发调用并将触发函数短路，便于断言挂载提交了 M09 变更检测。
// 2026-10-09（立场 1，关闭自动闭环）：原自动闭环工序 autoApplyManagementDomain 已移除，
// 故此处不再需要短路它——提交链路本就不再自动确认下发（只产 pending 草稿）。
func stubChangeTrigger(t *testing.T) *int32 {
	t.Helper()
	orig := triggerChangeDetection
	var calls int32
	triggerChangeDetection = func(db *gorm.DB) error { atomic.AddInt32(&calls, 1); return nil }
	t.Cleanup(func() {
		triggerChangeDetection = orig
	})
	return &calls
}

const validAMConfig = `global:
  resolve_timeout: 5m
route:
  receiver: default
receivers:
  - name: default
`

// --- Submit：校验通过 → 落库留痕 + 触发 M09 变更检测 ---

func TestSubmitPersistsOnValid(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	calls := stubChangeTrigger(t)

	v, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	require.NotNil(t, v)
	assert.NotZero(t, v.ID)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, v.Status)
	assert.Equal(t, models.AlertmanagerConfigChecksum(validAMConfig), v.Checksum)
	assert.Equal(t, "chenrt", v.AppliedBy)
	assert.Equal(t, validAMConfig, v.Content)

	// 已留痕。
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)

	// 已触发 M09 变更检测。
	assert.EqualValues(t, 1, atomic.LoadInt32(calls))
}

// --- Submit：校验失败 → 不落库、不触发变更检测 ---

func TestSubmitRejectsInvalidNoPersist(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolFails(t)
	calls := stubChangeTrigger(t)

	_, err := Submit(db, "route:\n  receiver: missing-recv\n", "chenrt")
	require.Error(t, err)
	var valErr *ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)

	// 不落库。
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 0, count)

	// 不进 M09 流水线（决策 60）。
	assert.EqualValues(t, 0, atomic.LoadInt32(calls))
}

// --- Submit：空内容 → bad_request（ErrEmptyContent） ---

func TestSubmitRejectsEmptyContent(t *testing.T) {
	db := newMemConfigDB(t)
	calls := stubChangeTrigger(t)

	_, err := Submit(db, "   \n", "chenrt")
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrEmptyContent)

	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 0, count)
	assert.EqualValues(t, 0, atomic.LoadInt32(calls))
}

// --- Submit：amtool 不可调用 → 校验失败（不落库）+ dev-feedback 登记 ---

func TestSubmitAmtoolUnavailableValidationFails(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolUnavailable(t)
	calls := stubChangeTrigger(t)

	// dev-feedback 登记钩子捕获。
	var fedback []string
	origDev := devfeedback
	devfeedback = func(msg string) { fedback = append(fedback, msg) }
	t.Cleanup(func() { devfeedback = origDev })

	_, err := Submit(db, validAMConfig, "chenrt")
	require.Error(t, err)
	var valErr *ErrValidation
	require.ErrorAs(t, err, &valErr)
	require.NotEmpty(t, valErr.Items)
	assert.True(t, strings.Contains(valErr.Items[0].Message, "amtool"), valErr.Items[0].Message)

	// 不落库。
	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 0, count)
	assert.EqualValues(t, 0, atomic.LoadInt32(calls))
	// dev-feedback 已登记。
	require.NotEmpty(t, fedback)
	assert.Contains(t, fedback[0], "amtool")
}

// --- Submit：同内容重复挂载幂等 ---

func TestSubmitIdempotentOnSameChecksum(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	calls := stubChangeTrigger(t)

	first, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	second, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	// 幂等：返回已有版本，不重复生成新版本。
	assert.Equal(t, first.ID, second.ID)

	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	// 幂等命中不额外触发变更检测。
	assert.EqualValues(t, 1, atomic.LoadInt32(calls))
}

// TestSubmitRevertToHistoricalContentCreatesNewVersion 锁死「改回旧内容」场景：
// 用户把接收人改了并生效后，再改回原值保存，必须生成**新版本**并再次触发产草稿。
//
// 回归背景：幂等查询原先在「任意历史 applied 版本」中按 checksum 命中即返回旧版本，
// 回退内容 A 必定命中最早那条 A 留痕 → 不落新版本、不触发 M09；而 M09 生成产物读的是
// LoadLatestAlertmanagerConfigVersion（最新一条 applied，仍是改后的 B），于是回退既
// 不产新变更单、也不会进入下发视图（用户实测「改不回去」）。
func TestSubmitRevertToHistoricalContentCreatesNewVersion(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	calls := stubChangeTrigger(t)
	ensureCalls := stubEnsurePendingDraft(t)

	original := validAMConfig
	changed := validAMConfig + "\n# 改后的接收人配置\n"

	v1, err := Submit(db, original, "chenrt")
	require.NoError(t, err)
	v2, err := Submit(db, changed, "chenrt")
	require.NoError(t, err)
	require.NotEqual(t, v1.ID, v2.ID)

	// 改回原值：内容与 v1 相同，但相对当前生效版本 v2 是一次实质变更。
	v3, err := Submit(db, original, "chenrt")
	require.NoError(t, err)
	assert.NotEqual(t, v1.ID, v3.ID, "回退到历史内容不得复用旧版本")
	assert.NotEqual(t, v2.ID, v3.ID)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, v3.Status)

	var count int64
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 3, count, "回退须落一条新留痕，供 M09 取到回退后的内容")

	// 回退须再次触发 M09 变更检测 + 产 pending 草稿（否则不会生成下发申请单）。
	assert.EqualValues(t, 3, atomic.LoadInt32(calls))
	assert.EqualValues(t, 3, atomic.LoadInt32(ensureCalls))

	// M09 生成产物读取的最新 applied 版本必须是回退后的内容。
	latest, err := LatestApplied(db)
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, v3.ID, latest.ID)
	assert.Equal(t, original, latest.Content)

	// 连续重复保存当前内容仍幂等：不重复落版本、不重复产草稿。
	again, err := Submit(db, original, "chenrt")
	require.NoError(t, err)
	assert.Equal(t, v3.ID, again.ID)
	require.NoError(t, db.Model(&models.AlertmanagerConfigVersion{}).Count(&count).Error)
	assert.EqualValues(t, 3, count)
	assert.EqualValues(t, 3, atomic.LoadInt32(calls))
}

// TestSubmitAfterDiscardedVersionCreatesNewVersion（dev-feedback #44 恢复路径）：
// 留痕被标记 discarded 终态（变更单已废弃）后，重新导入**同样内容**不得再走幂等分支——
// 否则用户被静默返回已废弃版本、既不产新版本也不产新变更单，「重新导入」这条最自然的
// 恢复路径被吞掉。修复：幂等查询仅认 status=applied 的留痕。
func TestSubmitAfterDiscardedVersionCreatesNewVersion(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	calls := stubChangeTrigger(t)
	ensureCalls := stubEnsurePendingDraft(t)

	first, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)

	// 模拟废弃联动：该留痕的变更单被废弃 → 标记 discarded 终态。
	require.NoError(t, db.Model(first).Update("status", models.AlertmanagerConfigStatusDiscarded).Error)

	// 重新导入同样内容 → 应生成**新版本**并再次触发产草稿（恢复路径成立）。
	second, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	assert.NotEqual(t, first.ID, second.ID, "discarded 留痕不满足幂等，须生成新版本")
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, second.Status)
	assert.EqualValues(t, 2, atomic.LoadInt32(calls), "新版本须再次触发 M09 变更检测")
	assert.EqualValues(t, 2, atomic.LoadInt32(ensureCalls), "新版本须再次产出 pending 草稿")
}

// TestLatestAppliedSkipsDiscarded：LatestApplied（当前生效视图数据源）排除 discarded
// 终态——已废弃留痕的内容不在磁盘上，不得作为「当前生效」呈现。
func TestLatestAppliedSkipsDiscarded(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)

	v1, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)
	// 更晚的一条留痕被废弃（变更单废弃联动）。
	v2, err := Submit(db, validAMConfig+"\n# 变更\n", "chenrt")
	require.NoError(t, err)
	require.NoError(t, db.Model(v2).Update("status", models.AlertmanagerConfigStatusDiscarded).Error)

	latest, err := LatestApplied(db)
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, v1.ID, latest.ID, "discarded 终态不得作为当前生效配置")
}

// --- LatestApplied / GetVersionByID 查询辅助 ---

func TestLatestAppliedAndGetVersionByID(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	// 无版本 → nil。
	cur, err := LatestApplied(db)
	require.NoError(t, err)
	assert.Nil(t, cur)

	v1, err := Submit(db, validAMConfig, "chenrt")
	require.NoError(t, err)

	// 有版本 → 返回最近一条。
	latest, err := LatestApplied(db)
	require.NoError(t, err)
	require.NotNil(t, latest)
	assert.Equal(t, v1.ID, latest.ID)

	got, err := GetVersionByID(db, v1.ID)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, validAMConfig, got.Content)

	miss, err := GetVersionByID(db, 99999)
	require.NoError(t, err)
	assert.Nil(t, miss)
}

// --- ErrValidation.Error ---

func TestErrValidationError(t *testing.T) {
	e := &ErrValidation{
		Items: []models.ValidateErrorItem{{File: "alertmanager.yml", Line: 14, Message: "boom"}},
		Note:  "n",
	}
	assert.Equal(t, "boom", e.Error())
	empty := &ErrValidation{}
	assert.Equal(t, "alertmanager config validation failed", empty.Error())
}
