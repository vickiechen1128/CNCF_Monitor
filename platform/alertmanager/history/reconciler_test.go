package history

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type fakeSource struct {
	active    []ActiveAlert
	startedAt time.Time
	listErr   error
	statusErr error
}

func (f *fakeSource) ListActiveAlerts(context.Context) ([]ActiveAlert, error) {
	return f.active, f.listErr
}

func (f *fakeSource) AlertmanagerStartedAt(context.Context) (time.Time, error) {
	return f.startedAt, f.statusErr
}

func seedOpenEvent(t *testing.T, db *gorm.DB, fp string, status models.AlertEventStatus, createdAt time.Time) *models.AlertEvent {
	t.Helper()
	ev := &models.AlertEvent{
		Fingerprint: fp,
		AlertName:   "InstanceDown",
		Status:      status,
		StartsAt:    &createdAt,
		Labels:      `{"alertname":"InstanceDown"}`,
	}
	require.NoError(t, db.Create(ev).Error)
	require.NoError(t, db.Model(ev).UpdateColumn("created_at", createdAt).Error)
	return ev
}

// seedOccurrenceEvent 造一条已结束的 occurrence（对账恢复原行用）。
func seedOccurrenceEvent(
	t *testing.T,
	db *gorm.DB,
	fp string,
	status models.AlertEventStatus,
	startsAt, closedAt time.Time,
) *models.AlertEvent {
	t.Helper()
	ev := &models.AlertEvent{
		Fingerprint:   fp,
		OccurrenceKey: models.AlertEventOccurrenceKey(fp, startsAt),
		AlertName:     "InstanceDown",
		Status:        status,
		StartsAt:      &startsAt,
		ClosedAt:      &closedAt,
		Labels:        `{"alertname":"InstanceDown"}`,
	}
	require.NoError(t, db.Create(ev).Error)
	return ev
}

func newFixedReconciler(db *gorm.DB, src AlertSource, now time.Time) *Reconciler {
	r := NewReconciler(db, src)
	r.now = func() time.Time { return now }
	return r
}

// TestReconcilerAlignsSilencedAndInhibited 活跃集对齐：静默/时间静音优先于抑制。
func TestReconcilerAlignsSilencedAndInhibited(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-silenced", models.AlertEventStatusFiring, now.Add(-10*time.Minute))
	seedOpenEvent(t, db, "fp-inhibited", models.AlertEventStatusFiring, now.Add(-10*time.Minute))
	seedOpenEvent(t, db, "fp-muted", models.AlertEventStatusFiring, now.Add(-10*time.Minute))

	src := &fakeSource{
		startedAt: now.Add(-time.Hour),
		active: []ActiveAlert{
			{Fingerprint: "fp-silenced", State: "suppressed", SilencedBy: []string{"silence-1"}, InhibitedBy: []string{"inhibit-1"}},
			{Fingerprint: "fp-inhibited", State: "suppressed", InhibitedBy: []string{"inhibit-1"}},
			{Fingerprint: "fp-muted", State: "suppressed", MutedBy: []string{"weekends"}},
		},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 3, summary.Aligned)

	var silenced models.AlertEvent
	require.NoError(t, db.Where("fingerprint = ?", "fp-silenced").First(&silenced).Error)
	assert.Equal(t, models.AlertEventStatusSilenced, silenced.Status, "静默优先于抑制")

	var inhibited models.AlertEvent
	require.NoError(t, db.Where("fingerprint = ?", "fp-inhibited").First(&inhibited).Error)
	assert.Equal(t, models.AlertEventStatusInhibited, inhibited.Status)

	var muted models.AlertEvent
	require.NoError(t, db.Where("fingerprint = ?", "fp-muted").First(&muted).Error)
	assert.Equal(t, models.AlertEventStatusSilenced, muted.Status, "时间区间静音按静默处理")
}

// TestReconcilerSilenceEndedReturnsToFiring 静默解除且告警仍在 → 回到告警中。
func TestReconcilerSilenceEndedReturnsToFiring(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-1", models.AlertEventStatusSilenced, now.Add(-10*time.Minute))

	src := &fakeSource{
		startedAt: now.Add(-time.Hour),
		active:    []ActiveAlert{{Fingerprint: "fp-1", State: "active"}},
	}
	_, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, models.AlertEventStatusFiring, ev.Status)
}

// TestReconcilerClosesDisappearedRows 消失的行按原状态区分终态，并写 closed_at：
// 静默中 → 静默期间结束；抑制中 → 抑制期间结束；其余 → 恢复信息丢失。
// 空活跃集需要连续两轮确认，故跑两轮。
func TestReconcilerClosesDisappearedRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-silenced", models.AlertEventStatusSilenced, now.Add(-10*time.Minute))
	seedOpenEvent(t, db, "fp-firing", models.AlertEventStatusFiring, now.Add(-10*time.Minute))
	seedOpenEvent(t, db, "fp-inhibited", models.AlertEventStatusInhibited, now.Add(-10*time.Minute))

	src := &fakeSource{startedAt: now.Add(-time.Hour)}
	r := newFixedReconciler(db, src, now)

	first, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, first.Closed, "空活跃集第一轮只确认，不关行")

	summary, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 3, summary.Closed)

	var silenced models.AlertEvent
	require.NoError(t, db.Where("fingerprint = ?", "fp-silenced").First(&silenced).Error)
	assert.Equal(t, models.AlertEventStatusSilencedClosed, silenced.Status)
	assert.Nil(t, silenced.EndsAt)
	require.NotNil(t, silenced.ClosedAt)

	var firing models.AlertEvent
	require.NoError(t, db.Where("fingerprint = ?", "fp-firing").First(&firing).Error)
	assert.Equal(t, models.AlertEventStatusLost, firing.Status)
	assert.Nil(t, firing.EndsAt)
	require.NotNil(t, firing.ClosedAt)

	var inhibited models.AlertEvent
	require.NoError(t, db.Where("fingerprint = ?", "fp-inhibited").First(&inhibited).Error)
	assert.Equal(t, models.AlertEventStatusInhibitedClosed, inhibited.Status)
	assert.Nil(t, inhibited.EndsAt)
	require.NotNil(t, inhibited.ClosedAt)
}

// TestReconcilerDoesNotCloseDuringAMRestart AM 启动不足 3 分钟时只对齐不关行。
func TestReconcilerDoesNotCloseDuringAMRestart(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-1", models.AlertEventStatusFiring, now.Add(-10*time.Minute))

	src := &fakeSource{startedAt: now.Add(-time.Minute)}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, summary.Closed)

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, models.AlertEventStatusFiring, ev.Status, "AM 重启重建窗口内不得误杀")
}

// TestReconcilerDoesNotCloseYoungRow 刚落库不足 2 分钟的行不关（webhook 可能还在路上）。
func TestReconcilerDoesNotCloseYoungRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-1", models.AlertEventStatusFiring, now.Add(-time.Minute))

	src := &fakeSource{startedAt: now.Add(-time.Hour)}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, summary.Closed)
}

// TestReconcilerBackfillsMissingRows 活跃集中有、库里没有的 active 告警补插一行。
func TestReconcilerBackfillsMissingRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	src := &fakeSource{
		startedAt: now.Add(-time.Hour),
		active: []ActiveAlert{{
			Fingerprint: "fp-new",
			State:       "active",
			Labels:      map[string]string{"alertname": "InstanceDown", "severity": "warning", "network_domain_id": "mc-test"},
			Annotations: map[string]string{"summary": "补插"},
			StartsAt:    now.Add(-5 * time.Minute),
		}},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Backfilled)

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, "fp-new", ev.Fingerprint)
	assert.Equal(t, models.AlertEventStatusFiring, ev.Status, "只有 active 漏记才补插，补插即告警中")
	assert.Equal(t, "mc-test", ev.NetworkDomain)
	assert.Equal(t, sourceReconcile, ev.Source)
	assert.Nil(t, ev.EndsAt)
	assert.Nil(t, ev.ClosedAt)
	assert.NotEmpty(t, ev.OccurrenceKey)
	_, offset := ev.StartsAt.Zone()
	assert.Equal(t, 8*3600, offset)
}

// TestReconcilerSkipsSuppressedBackfill 首次触发就被静默/抑制的告警不补插。
func TestReconcilerSkipsSuppressedBackfill(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	src := &fakeSource{
		startedAt: now.Add(-time.Hour),
		active: []ActiveAlert{{
			Fingerprint: "fp-silenced",
			State:       "suppressed",
			SilencedBy:  []string{"silence-1"},
			Labels:      map[string]string{"alertname": "InstanceDown"},
			StartsAt:    now.Add(-5 * time.Minute),
		}},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, summary.Backfilled)
	assert.EqualValues(t, 0, countEvents(t, db))
}

// TestReconcilerRestoresClosedRow 对账判定关闭后重新活跃 → 原行恢复未结束状态并清空 closed_at。
func TestReconcilerRestoresClosedRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	startsAt := now.Add(-time.Hour)
	ev := seedOccurrenceEvent(t, db, "fp-1", models.AlertEventStatusLost, startsAt, now.Add(-30*time.Minute))

	src := &fakeSource{
		startedAt: now.Add(-2 * time.Hour),
		active:    []ActiveAlert{{Fingerprint: "fp-1", State: "active", StartsAt: startsAt}},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, summary.Restored)
	assert.Zero(t, summary.Backfilled)

	var got models.AlertEvent
	require.NoError(t, db.First(&got, ev.ID).Error)
	assert.Equal(t, models.AlertEventStatusFiring, got.Status)
	assert.Nil(t, got.ClosedAt)
	assert.Nil(t, got.EndsAt)
}

// TestReconcilerDoesNotRestoreResolvedRow 已真实恢复的 occurrence 不复活，也不另插新行。
func TestReconcilerDoesNotRestoreResolvedRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	startsAt := now.Add(-time.Hour)
	endsAt := now.Add(-30 * time.Minute)
	ev := seedOccurrenceEvent(t, db, "fp-1", models.AlertEventStatusResolved, startsAt, endsAt)

	src := &fakeSource{
		startedAt: now.Add(-2 * time.Hour),
		active:    []ActiveAlert{{Fingerprint: "fp-1", State: "active", StartsAt: startsAt}},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, summary.Restored)
	assert.Zero(t, summary.Backfilled)

	var got models.AlertEvent
	require.NoError(t, db.First(&got, ev.ID).Error)
	assert.Equal(t, models.AlertEventStatusResolved, got.Status)
	assert.EqualValues(t, 1, countEvents(t, db))
}

// TestReconcilerEmptyActiveSetNeedsTwoRounds 空活跃集第一轮不关、第二轮才关。
func TestReconcilerEmptyActiveSetNeedsTwoRounds(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-1", models.AlertEventStatusFiring, now.Add(-10*time.Minute))

	src := &fakeSource{startedAt: now.Add(-time.Hour)}
	r := newFixedReconciler(db, src, now)

	first, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, first.Closed)

	second, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 1, second.Closed)
}

// TestReconcilerCloseRatioGuard 单轮关闭占比过高时先缓一轮，连续两轮确认后才关。
func TestReconcilerCloseRatioGuard(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	for i := 0; i < 12; i++ {
		seedOpenEvent(t, db, "fp-"+string(rune('a'+i)), models.AlertEventStatusFiring, now.Add(-10*time.Minute))
	}

	src := &fakeSource{startedAt: now.Add(-time.Hour)}
	r := newFixedReconciler(db, src, now)

	first, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, first.Closed, "空活跃集第一轮只确认")

	second, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, second.Closed, "关闭比例异常第一轮只确认")

	third, err := r.RunOnce(context.Background())
	require.NoError(t, err)
	assert.Equal(t, 12, third.Closed, "连续两轮确认后才执行关闭")
}

// TestReconcilerSkipsYoungBackfill 刚诞生不足 2 分钟的告警不补（别抢跑出重复行）。
func TestReconcilerSkipsYoungBackfill(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	src := &fakeSource{
		startedAt: now.Add(-time.Hour),
		active: []ActiveAlert{{
			Fingerprint: "fp-new",
			State:       "active",
			Labels:      map[string]string{"alertname": "InstanceDown"},
			StartsAt:    now.Add(-30 * time.Second),
		}},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, summary.Backfilled)
	assert.EqualValues(t, 0, countEvents(t, db))
}

// TestReconcilerSkipsEmptyFingerprint 无指纹实况不参与对账。
func TestReconcilerSkipsEmptyFingerprint(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	src := &fakeSource{
		startedAt: now.Add(-time.Hour),
		active:    []ActiveAlert{{Fingerprint: "", State: "active", Labels: map[string]string{"alertname": "X"}, StartsAt: now.Add(-time.Hour)}},
	}
	summary, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
	require.NoError(t, err)
	assert.Zero(t, summary.Backfilled)
}

// TestReconcilerSkipsWhenAMUnreachable AM 状态 / 活跃集不可达时整轮跳过、不误杀。
func TestReconcilerSkipsWhenAMUnreachable(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	seedOpenEvent(t, db, "fp-1", models.AlertEventStatusFiring, now.Add(-10*time.Minute))

	for _, src := range []*fakeSource{
		{statusErr: errors.New("am down")},
		{startedAt: now.Add(-time.Hour), listErr: errors.New("alerts api down")},
	} {
		_, err := newFixedReconciler(db, src, now).RunOnce(context.Background())
		require.Error(t, err)
		var ev models.AlertEvent
		require.NoError(t, db.First(&ev).Error)
		assert.Equal(t, models.AlertEventStatusFiring, ev.Status)
	}
}
