package history

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func seedEvent(t *testing.T, db *gorm.DB, fp string, status models.AlertEventStatus, startsAt time.Time, endsAt *time.Time) *models.AlertEvent {
	t.Helper()
	ev := &models.AlertEvent{
		Fingerprint:   fp,
		AlertName:     "InstanceDown-" + fp,
		Status:        status,
		Severity:      "critical",
		Summary:       "摘要-" + fp,
		NetworkDomain: "mc-test",
		Labels:        `{"alertname":"InstanceDown","severity":"critical","network_domain_id":"mc-test"}`,
		StartsAt:      &startsAt,
		EndsAt:        endsAt,
	}
	require.NoError(t, db.Create(ev).Error)
	return ev
}

// TestComputeStatsOverlapSemantics 锁定首页统计口径：
// 当日 / 近 7 天按「区间与窗口有交集」计——昨天触发、今天仍在告警的也必须计入当日，
// 否则「通知中 4、当日 0」的自相矛盾会再次出现。
func TestComputeStatsOverlapSemantics(t *testing.T) {
	db := newTestDB(t)
	loc := time.FixedZone("UTC+8", 8*3600)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, loc)

	// 1) 昨天触发、现在仍在告警 → 当日 + 近7天
	seedEvent(t, db, "open-yesterday", models.AlertEventStatusFiring,
		time.Date(2026, 10, 24, 9, 0, 0, 0, loc), nil)
	// 2) 今天触发并恢复 → 当日 + 近7天
	endsToday := time.Date(2026, 10, 25, 9, 0, 0, 0, loc)
	seedEvent(t, db, "resolved-today", models.AlertEventStatusResolved,
		time.Date(2026, 10, 25, 8, 0, 0, 0, loc), &endsToday)
	// 3) 4 天前触发并恢复 → 近7天，不计当日
	endsWeek := time.Date(2026, 10, 21, 9, 0, 0, 0, loc)
	seedEvent(t, db, "resolved-week", models.AlertEventStatusResolved,
		time.Date(2026, 10, 21, 8, 0, 0, 0, loc), &endsWeek)
	// 4) 窗口外 → 都不计
	endsOld := time.Date(2026, 10, 10, 9, 0, 0, 0, loc)
	seedEvent(t, db, "resolved-old", models.AlertEventStatusResolved,
		time.Date(2026, 10, 10, 8, 0, 0, 0, loc), &endsOld)
	// 5) 恢复信息丢失，今天发现关行 → 当日 + 近7天
	lost := seedEvent(t, db, "lost-today", models.AlertEventStatusLost,
		time.Date(2026, 10, 20, 8, 0, 0, 0, loc), nil)
	require.NoError(t, db.Exec("UPDATE alert_events SET updated_at = ? WHERE id = ?",
		time.Date(2026, 10, 25, 7, 0, 0, 0, loc), lost.ID).Error)
	// 6) 静默中 → 当日 + 近7天
	seedEvent(t, db, "silenced-open", models.AlertEventStatusSilenced,
		time.Date(2026, 10, 19, 8, 0, 0, 0, loc), nil)

	st, err := ComputeStats(db, now, loc)
	require.NoError(t, err)
	assert.EqualValues(t, 4, st.TodayTotal, "open×2 + resolved-today + lost-today")
	assert.EqualValues(t, 5, st.WeekTotal, "open×2 + 本周 resolved×2 + lost-today")
	assert.EqualValues(t, 1, st.OpenFiring)
	assert.EqualValues(t, 1, st.OpenSilenced)
	assert.EqualValues(t, 0, st.OpenInhibited)
}

// TestListEventsFiltersAndPagination 服务端过滤 / 排序 / 分页。
func TestListEventsFiltersAndPagination(t *testing.T) {
	db := newTestDB(t)
	loc := time.UTC
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, loc)
	seedEvent(t, db, "a", models.AlertEventStatusFiring, now.Add(-3*time.Hour), nil)
	seedEvent(t, db, "b", models.AlertEventStatusResolved, now.Add(-2*time.Hour), nil)
	seedEvent(t, db, "c", models.AlertEventStatusResolved, now.Add(-time.Hour), nil)

	all, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 2, Sort: "starts_at desc"})
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, all, 2)
	assert.Equal(t, "InstanceDown-c", all[0].AlertName, "默认按触发时间倒序")
	assert.Equal(t, "InstanceDown-b", all[1].AlertName)

	firing, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 20, Status: models.AlertEventStatusFiring})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, firing, 1)
	assert.Equal(t, models.AlertEventStatusFiring, firing[0].Status)

	byName, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 20, AlertName: "Down-b"})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, byName, 1)

	_, _, err = ListEvents(db, ListQuery{Page: 1, PageSize: 20, Status: "bogus"})
	require.Error(t, err, "非法状态须显式报错")
}

// TestWebhookHandlerAlways2xx 对 Alertmanager 永远 2xx：合法报文落库，畸形报文也只记日志。
func TestWebhookHandlerAlways2xx(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newTestDB(t)
	r := gin.New()
	r.POST(WebhookPath, WebhookHandler(db))

	payload := testPayload(testAlert("fp-1", "firing"))
	body, err := json.Marshal(payload)
	require.NoError(t, err)
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, WebhookPath, bytes.NewReader(body))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code)
	assert.EqualValues(t, 1, countEvents(t, db))

	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, WebhookPath, bytes.NewReader([]byte("{bad json")))
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusOK, w.Code, "畸形报文也必须返回 2xx，避免 AM 无限重试")
	assert.EqualValues(t, 1, countEvents(t, db))
}
