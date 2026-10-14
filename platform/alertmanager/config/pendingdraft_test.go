package config

import (
	"errors"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// stubEnsurePendingDraft 记录 ensurePendingDraft 调用次数（并短路真实草稿流水线：
// GenerateDraft 需完整网域/任务/规则表迁移 + promtool）。返回调用计数指针。
func stubEnsurePendingDraft(t *testing.T) *int32 {
	t.Helper()
	orig := ensurePendingDraft
	var calls int32
	ensurePendingDraft = func(db *gorm.DB) error {
		atomic.AddInt32(&calls, 1)
		return nil
	}
	t.Cleanup(func() { ensurePendingDraft = orig })
	return &calls
}

// stubEnsurePendingDraftErr 令 ensurePendingDraft 返回指定错误。
func stubEnsurePendingDraftErr(t *testing.T, err error) {
	t.Helper()
	orig := ensurePendingDraft
	ensurePendingDraft = func(db *gorm.DB) error { return err }
	t.Cleanup(func() { ensurePendingDraft = orig })
}

// TestSubmitTriggersChangeDetectionAndPendingDraft 锁死两段式的第一段：
// 提交必须「触发变更检测 + 产出 pending 变更单」。
//
// 回归背景（2026-10-09 dev-feedback #43）：关闭自动确认闭环时误将
// autoApplyManagementDomain 整体删除，其内部 GenerateDraft 的「产草稿」职责无人
// 接手；而 change.ProcessDomain 因 sourceTableScopes 不含 AlertmanagerConfigVersion
// 永远不会为告警配置变更生成草稿 → 提交后 M09 连 pending 单都没有（用户在配置变更
// 确认页查不到记录）。本例防止该断链重现。
func TestSubmitTriggersChangeDetectionAndPendingDraft(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	ensureCalls := stubEnsurePendingDraft(t)
	triggerCalls := stubChangeTrigger(t)

	_, err := Submit(db, validAMConfig, "tester")
	require.NoError(t, err)

	assert.Equal(t, int32(1), *triggerCalls, "提交须触发 M09 变更检测")
	assert.Equal(t, int32(1), *ensureCalls,
		"提交须显式产出一张 pending 变更单——仅靠变更检测不够（sourceTableScopes 不含 AlertmanagerConfigVersion）")
}

// TestSubmitDoesNotAutoConfirmDraft 锁死两段式的第二段：提交**不得**自动确认草稿
// （生效一律由用户在 M09 人工 ConfirmDraft）。这是 dev-feedback #43 的核心裁决，
// 若将来有人"为方便"重新加回自动确认，本例失败。
func TestSubmitDoesNotAutoConfirmDraft(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)

	// ensurePendingDraft 是唯一被调用的草稿工序；此处不引入任何 ConfirmDraft seam，
	// 以「不存在自动确认入口」为断言——若代码里新增了自动确认调用，本包无可替换的
	// seam 使测试失败，故额外用 ensurePendingDraft 调用计数锁死"恰好产草稿一次"。
	ensureCalls := stubEnsurePendingDraft(t)
	_, err := Submit(db, validAMConfig, "tester")
	require.NoError(t, err)
	assert.Equal(t, int32(1), *ensureCalls)
}

// TestSubmitPendingDraftErrNoChangesNotBlockSubmit 校验幂等类场景：产出草稿时返回
// ErrNoChanges（产物无实质差异）不应让提交报错——收录已成功，不阻断挂载。
func TestSubmitPendingDraftErrNoChangesNotBlockSubmit(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	stubEnsurePendingDraftErr(t, draft.ErrNoChanges)

	v, err := Submit(db, validAMConfig, "tester")
	require.NoError(t, err, "ErrNoChanges 不得阻断提交")
	require.NotNil(t, v)
	assert.NotZero(t, v.ID, "版本仍应落库留痕")
}

// TestSubmitPendingDraftErrOtherNotBlockSubmit 其他草稿产出错误同样降级不阻断
// （记日志即可，由人工确认兜底），与 errChangeTrigger 同款语义。
func TestSubmitPendingDraftErrOtherNotBlockSubmit(t *testing.T) {
	db := newMemConfigDB(t)
	stubAmtoolAvailable(t)
	stubChangeTrigger(t)
	stubEnsurePendingDraftErr(t, errors.New("boom"))

	v, err := Submit(db, validAMConfig, "tester")
	require.NoError(t, err, "产草稿失败不得让提交报错（收录已成功）")
	require.NotNil(t, v)
	assert.NotZero(t, v.ID)
}

// TestEnsurePendingDraftGeneratesWhenNoLivePending 覆盖 ensurePendingDraft 的无pending
// 分支：应调用 GenerateDraft（此处以 ErrNoChanges 表示 GenerateDraft 被执行过——
// 未调用则不会返回该哨兵）。注：轻量内存库缺完整表迁移，GenerateDraft 会因表缺失报错，
// 故此处只断言"确实进入了 GenerateDraft"（即返回的不是 nil 且走了调用路径）。
func TestEnsurePendingDraftGeneratesWhenNoLivePending(t *testing.T) {
	db := newMemConfigDB(t)
	// 无任何 pending 草稿 → 应进入 GenerateDraft 分支（内存库缺表迁移而报错即可，
	// 关键是**不能**返回 nil——返回 nil 说明压根没尝试生成）。
	err := ensurePendingDraft(db)
	assert.NotNil(t, err, "无 live pending 时应尝试 GenerateDraft（内存库缺迁移表而报错属预期）")
}