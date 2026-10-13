package deployment

import (
	"fmt"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestDispatchAlertmanagerWritebackPreciseSource（dev-feedback #44，fix C）：
// reuse 路径（取代判定 checksum 相同 → 复用旧单，不生成新单）——后挂载的同产物版本
// 骑在旧单上，确认旧单时**来源版本本身**必须被标记生效。旧实现取「最新一条 applied」
// 只标骑车版本、来源版本反而永久停在「已提交，待确认下发」（M08 版本历史遗留形态，
// 用户实测 id=18 同源）；且骑车窗版本同样标记（内容随本单下发）。
func TestDispatchAlertmanagerWritebackPreciseSource(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	src := seedAlertmanagerApplied(t, db, "route:\n  receiver: src\n")
	rider := seedAMVersionPending(t, db, "route:\n  receiver: src\n # 同产物骑窗版本\n")

	d := seedAMSourceDraft(t, db, "default", "CHG-20240901-200", src.ID)
	v := seedVersion(t, db, "default", "CHG-20240901-200")
	v.DraftID = fmt.Sprint(d.ID)
	v.AlertmanagerYml = "route:\n  receiver: src\n"
	require.NoError(t, db.Model(v).Updates(map[string]interface{}{
		"draft_id":         v.DraftID,
		"alertmanager_yml": v.AlertmanagerYml,
	}).Error)

	_, err := Dispatch(db, v, "admin", &applyRecorder{})
	require.NoError(t, err)

	var afterSrc, afterRider models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&afterSrc, src.ID).Error)
	require.NoError(t, db.First(&afterRider, rider.ID).Error)
	require.NotNil(t, afterSrc.AppliedAt, "来源版本必须标记生效（旧口径只标最新、来源反而遗留）")
	assert.Equal(t, "CHG-20240901-200", afterSrc.SourceChangeNo)
	require.NotNil(t, afterRider.AppliedAt, "同产物骑窗版本内容随本单下发，一并标记生效")
	assert.Equal(t, "CHG-20240901-200", afterRider.SourceChangeNo)
}

// TestDispatchAlertmanagerWritebackMarksSiblings：语义同 PreciseSource 的骑窗侧断言
// （单独成例便于定位回归）：来源之后挂载、产物经物化与本单 checksum 相同的兄弟留痕
// （reuse 路径：取代判定 checksum 相同 → 复用旧单，不生成新单），内容同样随本单
// 下发——应一并标记已生效，不应永久停在「已提交，待确认下发」。
func TestDispatchAlertmanagerWritebackMarksSiblings(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	src := seedAlertmanagerApplied(t, db, "route:\n  receiver: src\n")
	sibling := seedAMVersionPending(t, db, "route:\n  receiver: src\n # 同产物兄弟版本\n")

	d := seedAMSourceDraft(t, db, "default", "CHG-20240901-201", src.ID)
	v := seedVersion(t, db, "default", "CHG-20240901-201")
	v.DraftID = fmt.Sprint(d.ID)
	v.AlertmanagerYml = "route:\n  receiver: src\n"
	require.NoError(t, db.Model(v).Updates(map[string]interface{}{
		"draft_id":         v.DraftID,
		"alertmanager_yml": v.AlertmanagerYml,
	}).Error)

	_, err := Dispatch(db, v, "admin", &applyRecorder{})
	require.NoError(t, err)

	var afterSibling models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&afterSibling, sibling.ID).Error)
	require.NotNil(t, afterSibling.AppliedAt, "同产物兄弟版本应随本单标记已生效")
	assert.Equal(t, "CHG-20240901-201", afterSibling.SourceChangeNo)
}

// TestDispatchAlertmanagerWritebackSkipsDiscardedSibling：废弃联标记的 discarded 留痕
// 不被兄弟回写 resurrect（其产物未随本单下发；竞态残留保护）。
func TestDispatchAlertmanagerWritebackSkipsDiscardedSibling(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	src := seedAlertmanagerApplied(t, db, "route:\n  receiver: src\n")
	discarded := seedAMVersionPending(t, db, "route:\n  receiver: gone\n")
	require.NoError(t, db.Model(discarded).Update("status", models.AlertmanagerConfigStatusDiscarded).Error)

	d := seedAMSourceDraft(t, db, "default", "CHG-20240901-202", src.ID)
	v := seedVersion(t, db, "default", "CHG-20240901-202")
	v.DraftID = fmt.Sprint(d.ID)
	v.AlertmanagerYml = "route:\n  receiver: src\n"
	require.NoError(t, db.Model(v).Updates(map[string]interface{}{
		"draft_id":         v.DraftID,
		"alertmanager_yml": v.AlertmanagerYml,
	}).Error)

	_, err := Dispatch(db, v, "admin", &applyRecorder{})
	require.NoError(t, err)

	var after models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&after, discarded.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusDiscarded, after.Status,
		"discarded 留痕不被兄弟回写复活")
	assert.Nil(t, after.AppliedAt)
}

// TestDispatchAlertmanagerWritebackLegacyFallback：存量单（草稿无来源记录）回落旧口径，
// 但仅补**未生效**的最新留痕，不覆盖已生效版本的时间戳（旧实现无条件回填最新一条，
// 会把已生效版本的 applied_at 改写成本次确认时间）。
func TestDispatchAlertmanagerWritebackLegacyFallback(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	appliedAt := time.Now().Add(-time.Hour)
	confirmed := seedAlertmanagerApplied(t, db, "route:\n  receiver: confirmed\n")
	require.NoError(t, db.Model(confirmed).Updates(map[string]interface{}{
		"applied_at":       appliedAt,
		"source_change_no": "CHG-20240901-199",
	}).Error)
	pending := seedAMVersionPending(t, db, "route:\n  receiver: pending\n")

	// 存量单：draft 存在但 AlertmanagerSourceVersionID = 0。
	d := seedAMSourceDraft(t, db, "default", "CHG-20240901-203", 0)
	v := seedVersion(t, db, "default", "CHG-20240901-203")
	v.DraftID = fmt.Sprint(d.ID)
	v.AlertmanagerYml = "route:\n  receiver: pending\n"
	require.NoError(t, db.Model(v).Updates(map[string]interface{}{
		"draft_id":         v.DraftID,
		"alertmanager_yml": v.AlertmanagerYml,
	}).Error)

	_, err := Dispatch(db, v, "admin", &applyRecorder{})
	require.NoError(t, err)

	var afterPending, afterConfirmed models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&afterPending, pending.ID).Error)
	require.NoError(t, db.First(&afterConfirmed, confirmed.ID).Error)
	require.NotNil(t, afterPending.AppliedAt, "存量回落应补最新未生效留痕")
	assert.Equal(t, "CHG-20240901-203", afterPending.SourceChangeNo)
	require.NotNil(t, afterConfirmed.AppliedAt, "已生效留痕的时间戳不得被覆盖")
	assert.WithinDuration(t, appliedAt, *afterConfirmed.AppliedAt, time.Second)
	assert.Equal(t, "CHG-20240901-199", afterConfirmed.SourceChangeNo, "已生效留痕的来源单不得被改写")
}

// TestDispatchAlertmanagerWritebackSelfHealsDiscardedSource：来源留痕曾被废弃联标记
// discarded，其单随后被确认——回写把状态自愈为 applied（确认即生效信号）。
func TestDispatchAlertmanagerWritebackSelfHealsDiscardedSource(t *testing.T) {
	db := newMemDB(t)
	seedLocalDomain(t, db, "default")
	src := seedAMVersionPending(t, db, "route:\n  receiver: src\n")
	require.NoError(t, db.Model(src).Update("status", models.AlertmanagerConfigStatusDiscarded).Error)

	d := seedAMSourceDraft(t, db, "default", "CHG-20240901-204", src.ID)
	v := seedVersion(t, db, "default", "CHG-20240901-204")
	v.DraftID = fmt.Sprint(d.ID)
	v.AlertmanagerYml = "route:\n  receiver: src\n"
	require.NoError(t, db.Model(v).Updates(map[string]interface{}{
		"draft_id":         v.DraftID,
		"alertmanager_yml": v.AlertmanagerYml,
	}).Error)

	_, err := Dispatch(db, v, "admin", &applyRecorder{})
	require.NoError(t, err)

	var after models.AlertmanagerConfigVersion
	require.NoError(t, db.First(&after, src.ID).Error)
	assert.Equal(t, models.AlertmanagerConfigStatusApplied, after.Status, "确认下发自愈 discarded → applied")
	require.NotNil(t, after.AppliedAt)
	assert.Equal(t, "CHG-20240901-204", after.SourceChangeNo)
}

// seedAMVersionPending 造一条待确认留痕（status=applied，applied_at 为空）。
func seedAMVersionPending(t *testing.T, db *gorm.DB, content string) *models.AlertmanagerConfigVersion {
	t.Helper()
	v := &models.AlertmanagerConfigVersion{
		Content:   content,
		Checksum:  models.AlertmanagerConfigChecksum(content),
		Status:    models.AlertmanagerConfigStatusApplied,
		AppliedBy: "tester",
	}
	require.NoError(t, db.Create(v).Error)
	return v
}

// seedAMSourceDraft 造一条登记了 AM 来源留痕 ID 的草稿（0 = 存量单无记录）。
func seedAMSourceDraft(t *testing.T, db *gorm.DB, domainID, changeNo string, sourceAMVersionID uint) *models.ConfigDraft {
	t.Helper()
	d := &models.ConfigDraft{
		NetworkDomainID:             domainID,
		ChangeNo:                    changeNo,
		Status:                      models.DraftStatusConfirmed,
		ValidationStatus:            string(models.ValidationStatusPassed),
		AlertmanagerSourceVersionID: sourceAMVersionID,
	}
	require.NoError(t, db.Create(d).Error)
	return d
}
