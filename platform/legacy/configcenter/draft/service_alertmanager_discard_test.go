package draft

import (
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestDiscardDraftMarksOrphanAlertmanagerVersions 回归用户实测遗留问题（dev-feedback #44）：
// 管理域变更单被废弃后，其来源的告警配置留痕必须标记 discarded 终态——否则 applied_at
// 永为空，M08 版本历史永久显示「已提交，待确认下发」（id=18：其单 CHG-20261013-002
// 生成 17 秒即被废弃，单子在库、状态 discarded，仅因 M09 列表默认按 pending 过滤
// 而「看不到」，被误判为脏数据）。
func TestDiscardDraftMarksOrphanAlertmanagerVersions(t *testing.T) {
	db := newMemDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	v17 := seedAMVersion(t, db, "route:\n  receiver: a\n", false)
	v18 := seedAMVersion(t, db, "route:\n  receiver: b\n", false)
	d := seedDraftWithStatus(t, db, "CHG-99991013-002", models.DefaultDomainID,
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	require.NoError(t, db.Model(d).Update("alertmanager_source_version_id", v18.ID).Error)

	_, _, err := DiscardDraft(db, d.ChangeNo)
	require.NoError(t, err)

	var after17, after18 models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&after17, v17.ID).Error)
	require.NoError(t, db.First(&after18, v18.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusDiscarded, after17.Status,
		"无活单可确认的留痕一律标记 discarded（含更早挂载的兄弟版本）")
	assert.Equal(t, models.AlertmanagerConfigStatusDiscarded, after18.Status,
		"本单来源留痕同样标记 discarded——废弃即终态，不再显示「已提交，待确认下发」")
	assert.Nil(t, after18.AppliedAt, "废弃不伪造生效信号")
}

// TestDiscardDraftKeepsAppliedAlertmanagerVersion：已生效（applied_at 有值）与已关联
// 下发单的留痕不受废弃影响——它们不依赖任何在途单。
func TestDiscardDraftKeepsAppliedAlertmanagerVersion(t *testing.T) {
	db := newMemDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	applied := seedAMVersion(t, db, "route:\n  receiver: a\n", true)
	applied.SourceChangeNo = "CHG-20261010-008"
	require.NoError(t, db.Model(applied).Updates(map[string]interface{}{
		"applied_at":       time.Now(),
		"source_change_no": "CHG-20261010-008",
	}).Error)
	seedAMVersion(t, db, "route:\n  receiver: b\n", false)

	d := seedDraftWithStatus(t, db, "CHG-99991013-003", models.DefaultDomainID,
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	_, _, err := DiscardDraft(db, d.ChangeNo)
	require.NoError(t, err)

	var after models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&after, applied.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, after.Status, "已生效留痕不被废弃联动触碰")
	require.NotNil(t, after.AppliedAt)
}

// TestDiscardDraftNonDefaultDomainKeepsAlertmanagerVersions：告警配置恒属管理域
// （决策 60）——非管理域变更单废弃不触碰全局留痕（其来源单可能仍是活 pending）。
func TestDiscardDraftNonDefaultDomainKeepsAlertmanagerVersions(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-x", true)
	v := seedAMVersion(t, db, "route:\n  receiver: a\n", false)

	d := seedDraftWithStatus(t, db, "CHG-99991013-004", "edge-x",
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	_, _, err := DiscardDraft(db, d.ChangeNo)
	require.NoError(t, err)

	var after models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&after, v.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, after.Status,
		"非管理域废弃不标记告警配置留痕（其确认单在管理域侧，仍可能存活）")
}

// TestDiscardDraftProtectsOtherLivePendingSource：竞态残留的双活单场景——废弃其中一张，
// 另一张的来源版本必须保留（仍可被确认下发），不得误标 discarded。
func TestDiscardDraftProtectsOtherLivePendingSource(t *testing.T) {
	db := newMemDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	orphan := seedAMVersion(t, db, "route:\n  receiver: a\n", false)
	live := seedAMVersion(t, db, "route:\n  receiver: b\n", false)

	dropped := seedDraftWithStatus(t, db, "CHG-99991013-005", models.DefaultDomainID,
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	dropped.AlertmanagerSourceVersionID = orphan.ID
	require.NoError(t, db.Model(dropped).Update("alertmanager_source_version_id", orphan.ID).Error)
	kept := seedDraftWithStatus(t, db, "CHG-99991013-006", models.DefaultDomainID,
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	kept.AlertmanagerSourceVersionID = live.ID
	require.NoError(t, db.Model(kept).Update("alertmanager_source_version_id", live.ID).Error)

	_, _, err := DiscardDraft(db, dropped.ChangeNo)
	require.NoError(t, err)

	var afterOrphan, afterLive models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&afterOrphan, orphan.ID).Error)
	require.NoError(t, db.First(&afterLive, live.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusDiscarded, afterOrphan.Status, "被弃单的来源标记终态")
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, afterLive.Status,
		"另一张活单的来源版本受保护，仍可确认下发")
}

// TestSupersedePendingProtectsNewDraftSource（dev-feedback #44 取代路径）：挂载新版本
// 触发取代时，旧单来源留痕标记 discarded，新单来源保留——否则旧留痕同样永久卡在
// 「已提交，待确认下发」。
func TestSupersedePendingProtectsNewDraftSource(t *testing.T) {
	db := newMemDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	old := seedAMVersion(t, db, "route:\n  receiver: old\n", false)

	// 旧单：来源 = old 留痕。
	existing := seedDraftWithStatus(t, db, "CHG-99991013-007", models.DefaultDomainID,
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	existing.AlertmanagerSourceVersionID = old.ID
	require.NoError(t, db.Model(existing).Update("alertmanager_source_version_id", old.ID).Error)

	// 新留痕 + 新单（取代）：来源 = 新留痕。
	fresh := seedAMVersion(t, db, "route:\n  receiver: fresh\n", false)
	newDraft := seedDraftWithStatus(t, db, "CHG-99991013-008", models.DefaultDomainID,
		string(models.DraftStatusPending), string(models.ValidationStatusPassed))
	newDraft.AlertmanagerSourceVersionID = fresh.ID
	require.NoError(t, db.Model(newDraft).Update("alertmanager_source_version_id", fresh.ID).Error)

	// 直接驱动取代事务内的联动逻辑（existing 被 fresh 单取代）。
	err := discardOrphanAlertmanagerVersions(db, []uint{newDraft.AlertmanagerSourceVersionID})
	require.NoError(t, err)

	var afterOld, afterFresh models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&afterOld, old.ID).Error)
	require.NoError(t, db.First(&afterFresh, fresh.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusDiscarded, afterOld.Status, "被取代旧单的来源标记终态")
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, afterFresh.Status, "新单来源受保护")
}

// TestGenerateDraftBackfillsAlertmanagerSourceVersionID（fix C 配套）：管理域草稿生成时
// 登记 AM 产物来源留痕 ID，且与产物内容同源（buildArtifacts 一次加载）。
func TestGenerateDraftBackfillsAlertmanagerSourceVersionID(t *testing.T) {
	db := newMemDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	v := seedAMVersion(t, db, "route:\n  receiver: default\nreceivers:\n  - name: default\n", false)

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	assert.Equal(t, v.ID, d.AlertmanagerSourceVersionID,
		"草稿须登记 AM 产物来源留痕 ID（确认下发按它精确回填，取代「取最新 applied」错链口径）")
	assert.Contains(t, d.AlertmanagerYml, "receiver: default", "产物内容来自该留痕")
}

// TestGenerateDraftNoAlertmanagerSourceWhenNoVersion：无留痕时来源 ID 为 0（回落旧口径）。
func TestGenerateDraftNoAlertmanagerSourceWhenNoVersion(t *testing.T) {
	db := newMemDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedHost(t, db, models.DefaultDomainID, "res-1")
	seedJob(t, db, models.DefaultDomainID, "job1")

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	assert.Zero(t, d.AlertmanagerSourceVersionID, "无 AM 留痕时来源 ID 为 0")
}

// seedAMVersion 造一条告警配置留痕；applied=true 时回填 applied_at（已生效）。
func seedAMVersion(t *testing.T, db *gorm.DB, content string, applied bool) *models.AlertmanagerConfigVersion {
	t.Helper()
	v := &models.AlertmanagerConfigVersion{
		Content:   content,
		Checksum:  models.AlertmanagerConfigChecksum(content),
		Status:    models.AlertmanagerConfigStatusApplied,
		AppliedBy: "tester",
	}
	if applied {
		now := time.Now()
		v.AppliedAt = &now
	}
	require.NoError(t, db.Create(v).Error)
	return v
}
