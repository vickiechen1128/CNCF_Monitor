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
// alertmanager config version table.
func newMemConfigDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:amcfg_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.AlertmanagerConfigVersion{}))
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
func stubChangeTrigger(t *testing.T) *int32 {
	t.Helper()
	orig := triggerChangeDetection
	var calls int32
	triggerChangeDetection = func(db *gorm.DB) error { atomic.AddInt32(&calls, 1); return nil }
	t.Cleanup(func() { triggerChangeDetection = orig })
	return &calls
}

const validAMConfig = `global:
  resolve_timeout: 5m
route:
  receiver: default
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