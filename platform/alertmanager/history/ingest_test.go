package history

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var testDBCounter int64

// newTestDB 打开每个用例独立的内存 SQLite，迁移 alert_events 并建部分唯一索引。
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&testDBCounter, 1)
	dsn := fmt.Sprintf("file:alert_history_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.AlertEvent{}))
	require.NoError(t, db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_open_fingerprint
		ON alert_events(fingerprint)
		WHERE fingerprint <> '' AND status IN ('firing','silenced','inhibited') AND deleted_at IS NULL`).Error)
	return db
}

func testAlert(fingerprint, status string) PayloadAlert {
	t := time.Date(2026, 10, 25, 8, 0, 0, 0, time.UTC)
	return PayloadAlert{
		Status:      status,
		Fingerprint: fingerprint,
		Labels: map[string]string{
			"alertname":         "InstanceDown",
			"severity":          "critical",
			"instance":          "10.0.0.1:9100",
			"network_domain_id": "mc-test",
		},
		Annotations: map[string]string{"summary": "实例失联"},
		StartsAt:    t,
		EndsAt:      t.Add(10 * time.Minute),
	}
}

func testPayload(a PayloadAlert) Payload {
	return Payload{Version: "4", Status: a.Status, Receiver: "notify-1", GroupKey: "group-1", Alerts: []PayloadAlert{a}}
}

func countEvents(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	require.NoError(t, db.Model(&models.AlertEvent{}).Count(&n).Error)
	return n
}

// TestIngestFiringInsertAndDuplicate 锁死「未恢复期间重复推送不产生新行」：
// 第一次落一行 firing，第二次只刷新最后通知时间。
func TestIngestFiringInsertAndDuplicate(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)

	res := Ingest(db, testPayload(testAlert("fp-1", "firing")), now)
	assert.Equal(t, 1, res.Inserted)
	assert.EqualValues(t, 1, countEvents(t, db))

	now2 := now.Add(4 * time.Hour)
	res = Ingest(db, testPayload(testAlert("fp-1", "firing")), now2)
	assert.Equal(t, 1, res.Skipped)
	assert.EqualValues(t, 1, countEvents(t, db), "重复推送不得产生新行")

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, models.AlertEventStatusFiring, ev.Status)
	assert.Nil(t, ev.EndsAt, "firing 报文的 endsAt 是预测值，不得落库")
	require.NotNil(t, ev.LastNotifiedAt)
	assert.True(t, ev.LastNotifiedAt.Equal(now2), "重复推送应刷新最后通知时间")
	assert.Equal(t, "mc-test", ev.NetworkDomain)
	assert.Equal(t, "InstanceDown", ev.AlertName)
	assert.Equal(t, "实例失联", ev.Summary)
}

// TestIngestResolvedBackfillsSameRow 恢复回填同一行并写入真实恢复时间。
func TestIngestResolvedBackfillsSameRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	Ingest(db, testPayload(testAlert("fp-1", "firing")), now)

	alert := testAlert("fp-1", "resolved")
	alert.EndsAt = now.Add(30 * time.Minute)
	res := Ingest(db, testPayload(alert), now.Add(30*time.Minute))
	assert.Equal(t, 1, res.Updated)
	assert.EqualValues(t, 1, countEvents(t, db))

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, models.AlertEventStatusResolved, ev.Status)
	require.NotNil(t, ev.EndsAt)
	assert.True(t, ev.EndsAt.Equal(alert.EndsAt))
}

// TestIngestResolvedWithoutFiringInserts 触发推送丢失时，恢复事实也要兜底留痕。
func TestIngestResolvedWithoutFiringInserts(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	alert := testAlert("fp-1", "resolved")
	res := Ingest(db, testPayload(alert), now)
	assert.Equal(t, 1, res.Inserted)
	assert.EqualValues(t, 1, countEvents(t, db))

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, models.AlertEventStatusResolved, ev.Status)
	require.NotNil(t, ev.EndsAt)
}

// TestIngestRefireAfterResolvedCreatesNewRow 恢复后再次触发是新一次发生，旧行不动。
func TestIngestRefireAfterResolvedCreatesNewRow(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	Ingest(db, testPayload(testAlert("fp-1", "firing")), now)
	Ingest(db, testPayload(testAlert("fp-1", "resolved")), now.Add(time.Minute))
	Ingest(db, testPayload(testAlert("fp-1", "firing")), now.Add(2*time.Minute))

	assert.EqualValues(t, 2, countEvents(t, db), "恢复后再次触发必须新开一行")
	var rows []models.AlertEvent
	require.NoError(t, db.Order("id ASC").Find(&rows).Error)
	assert.Equal(t, models.AlertEventStatusResolved, rows[0].Status)
	assert.Equal(t, models.AlertEventStatusFiring, rows[1].Status)
}

// TestIngestFiringDoesNotDowngradeSilenced 静默中的行收到迟到 firing 推送时，
// 只刷新通知时间，不得把状态改回 firing（状态互跳只由对账写）。
func TestIngestFiringDoesNotDowngradeSilenced(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	alert := testAlert("fp-1", "firing")
	require.NoError(t, db.Create(buildEvent(testPayload(alert), alert,
		models.AlertEventStatusSilenced, nil, alert.Labels, alert.Annotations, now, sourceReconcile)).Error)

	res := Ingest(db, testPayload(alert), now.Add(time.Minute))
	assert.Equal(t, 1, res.Skipped)

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, models.AlertEventStatusSilenced, ev.Status, "webhook 不得覆盖对账的静默状态")
}

// TestIngestWithoutFingerprintStoresRaw 无指纹报文原样落库，不参与合并。
func TestIngestWithoutFingerprintStoresRaw(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)
	alert := testAlert("", "firing")
	alert.Labels["alertname"] = ""
	Ingest(db, testPayload(alert), now)
	Ingest(db, testPayload(alert), now.Add(time.Minute))
	assert.EqualValues(t, 2, countEvents(t, db), "无指纹无法合并，按流水原样落库")

	var ev models.AlertEvent
	require.NoError(t, db.First(&ev).Error)
	assert.Equal(t, alertNamePlaceholder, ev.AlertName)
	assert.Empty(t, ev.Fingerprint)
}
