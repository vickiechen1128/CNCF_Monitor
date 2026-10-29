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

func seedEvent(
	t *testing.T,
	db *gorm.DB,
	fp string,
	status models.AlertEventStatus,
	startsAt time.Time,
	endsAt, closedAt *time.Time,
) *models.AlertEvent {
	t.Helper()
	ev := &models.AlertEvent{
		Fingerprint:   fp,
		OccurrenceKey: models.AlertEventOccurrenceKey(fp, startsAt),
		AlertName:     "InstanceDown-" + fp,
		Status:        status,
		Severity:      "critical",
		Summary:       "摘要-" + fp,
		NetworkDomain: "mc-test",
		Labels:        `{"alertname":"InstanceDown","severity":"critical","network_domain_id":"mc-test"}`,
		StartsAt:      &startsAt,
		EndsAt:        endsAt,
		ClosedAt:      closedAt,
	}
	require.NoError(t, db.Create(ev).Error)
	return ev
}

// TestComputeStatsFourMetrics 锁定首页四指标口径：
// 今日告警严格按开始时间；今日恢复要求开始和关闭都在今天；
// 历史遗留是今天 0 点时的遗留量（当前未结或今天关闭）；历史遗留今日恢复 = 开始于今天之前 + 今天关闭。
func TestComputeStatsFourMetrics(t *testing.T) {
	db := newTestDB(t)
	loc := time.FixedZone("UTC+8", 8*3600)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, loc)
	at := func(day, hour int) time.Time {
		return time.Date(2026, 10, day, hour, 0, 0, 0, loc)
	}

	// 1) 昨天触发、现在仍在告警：不算今日告警，算历史遗留。
	seedEvent(t, db, "open-yesterday", models.AlertEventStatusFiring, at(24, 9), nil, nil)
	// 2) 今天触发并真实恢复：算今日告警 + 今日恢复（真实）。
	closedToday := at(25, 9)
	seedEvent(t, db, "resolved-today", models.AlertEventStatusResolved, at(25, 8), &closedToday, &closedToday)
	// 3) 4 天前触发并恢复：算近 7 天，不算今日。
	closedWeek := at(21, 9)
	seedEvent(t, db, "resolved-week", models.AlertEventStatusResolved, at(21, 8), &closedWeek, &closedWeek)
	// 4) 窗口外：都不计。
	closedOld := at(10, 9)
	seedEvent(t, db, "resolved-old", models.AlertEventStatusResolved, at(10, 8), &closedOld, &closedOld)
	// 5) 恢复信息丢失、今天发现关闭：算今日恢复（未知）+ 历史遗留今日恢复。
	closedLost := at(25, 7)
	seedEvent(t, db, "lost-today", models.AlertEventStatusLost, at(20, 8), nil, &closedLost)
	// 6) 静默中、昨天开始：算历史遗留。
	seedEvent(t, db, "silenced-open", models.AlertEventStatusSilenced, at(24, 8), nil, nil)
	// 7) 抑制期间结束、昨天关闭：不算今日恢复。
	closedInhibited := at(24, 23)
	seedEvent(t, db, "inhibited-closed", models.AlertEventStatusInhibitedClosed, at(24, 8), nil, &closedInhibited)
	// 8) 前天开始、今天真实恢复：历史遗留今日恢复（真实）。
	closedLegacyReal := at(25, 6)
	seedEvent(t, db, "legacy-resolved-real", models.AlertEventStatusResolved, at(23, 8), &closedLegacyReal, &closedLegacyReal)

	st, err := ComputeStats(db, now, loc)
	require.NoError(t, err)
	assert.EqualValues(t, 1, st.TodayTotal, "只有今天开始的 resolved-today")
	assert.EqualValues(t, 1, st.TodayResolvedTotal, "只有今天开始并关闭的 resolved-today")
	assert.EqualValues(t, 1, st.TodayResolvedReal, "历史告警今天恢复不计入今日恢复")
	assert.EqualValues(t, 0, st.TodayResolvedInferred, "lost-today 只计入历史遗留今日恢复")
	assert.EqualValues(t, 4, st.LegacyOpenTotal, "今天 0 点遗留：2 条仍未结 + 2 条今天关闭")
	assert.EqualValues(t, 1, st.LegacyOpenFiring)
	assert.EqualValues(t, 1, st.LegacyOpenSilenced)
	assert.EqualValues(t, 0, st.LegacyOpenInhibited)
	assert.EqualValues(t, 2, st.LegacyResolvedTodayTotal, "lost-today + legacy-resolved-real")
	assert.EqualValues(t, 1, st.LegacyResolvedTodayReal)
	assert.EqualValues(t, 1, st.LegacyResolvedTodayInferred)

	// 当前未结（不限今天）：open-yesterday(firing) + silenced-open(silenced)。
	assert.EqualValues(t, 2, st.OpenTotal)
	assert.EqualValues(t, 1, st.OpenFiring)
	assert.EqualValues(t, 1, st.OpenSilenced)
	assert.EqualValues(t, 0, st.OpenInhibited)
}

// TestListEventsFiltersAndPagination 服务端过滤 / 排序 / 分页。
func TestListEventsFiltersAndPagination(t *testing.T) {
	db := newTestDB(t)
	loc := time.UTC
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, loc)
	seedEvent(t, db, "a", models.AlertEventStatusFiring, now.Add(-3*time.Hour), nil, nil)
	seedEvent(t, db, "b", models.AlertEventStatusResolved, now.Add(-2*time.Hour), nil, nil)
	seedEvent(t, db, "c", models.AlertEventStatusResolved, now.Add(-time.Hour), nil, nil)

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

	require.NoError(t, db.Model(&models.AlertEvent{}).Where("fingerprint = ?", "b").Update("description", "数据库连接超时").Error)
	byDescription, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 20, Description: "连接超时"})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, byDescription, 1)
	assert.Equal(t, "InstanceDown-b", byDescription[0].AlertName)

	_, _, err = ListEvents(db, ListQuery{Page: 1, PageSize: 20, Status: "bogus"})
	require.Error(t, err, "非法状态须显式报错")
}

// TestListEventsStatusGroupOpen 锁定 status=open 分组：只返回未结三态，
// 供「当前告警」页与首页右栏复用同一口径。
func TestListEventsStatusGroupOpen(t *testing.T) {
	db := newTestDB(t)
	now := time.Now().UTC()
	seedEvent(t, db, "firing", models.AlertEventStatusFiring, now.Add(-3*time.Hour), nil, nil)
	seedEvent(t, db, "silenced", models.AlertEventStatusSilenced, now.Add(-2*time.Hour), nil, nil)
	seedEvent(t, db, "inhibited", models.AlertEventStatusInhibited, now.Add(-time.Hour), nil, nil)
	closed := now.Add(-30 * time.Minute)
	seedEvent(t, db, "resolved", models.AlertEventStatusResolved, now.Add(-4*time.Hour), &closed, &closed)

	open, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 20, StatusGroup: statusGroupOpen})
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	require.Len(t, open, 3)
	for _, ev := range open {
		assert.True(t, models.IsOpenAlertEventStatus(ev.Status), "open 分组不得包含终态：%s", ev.Status)
	}

	// 精确状态过滤与分组过滤互不影响。
	firing, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 20, Status: models.AlertEventStatusFiring})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, firing, 1)
}

// TestParseListQueryStatusGroupOpen status=open 是分组别名，不能按非法七态报错；
// 其他非法值仍须显式报错。
func TestParseListQueryStatusGroupOpen(t *testing.T) {
	gin.SetMode(gin.TestMode)
	newCtx := func(rawQuery string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/?"+rawQuery, nil)
		return c
	}

	q, err := parseListQuery(newCtx("status=open"))
	require.NoError(t, err)
	assert.Equal(t, statusGroupOpen, q.StatusGroup)
	assert.Empty(t, q.Status)

	_, err = parseListQuery(newCtx("status=bogus"))
	require.Error(t, err)
}

// TestComputeStatsFilteredByDomain 网域筛选同时作用于未结计数与四格指标。
func TestComputeStatsFilteredByDomain(t *testing.T) {
	db := newTestDB(t)
	loc := time.FixedZone("UTC+8", 8*3600)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, loc)

	inDomain := seedEvent(t, db, "in-domain", models.AlertEventStatusFiring, now.Add(-time.Hour), nil, nil)
	other := seedEvent(t, db, "other-domain", models.AlertEventStatusFiring, now.Add(-time.Hour), nil, nil)
	require.NoError(t, db.Model(other).Update("network_domain", "mc-other").Error)

	all, err := ComputeStats(db, now, loc)
	require.NoError(t, err)
	assert.EqualValues(t, 2, all.OpenTotal)

	filtered, err := ComputeStatsFiltered(db, now, loc, "mc-test")
	require.NoError(t, err)
	assert.EqualValues(t, 1, filtered.OpenTotal)
	assert.EqualValues(t, 1, filtered.OpenFiring)
	assert.EqualValues(t, 1, filtered.TodayTotal)
	assert.Equal(t, inDomain.ID, inDomain.ID)
}

// TestListEventsNormalizesTimeFiltersToCST 时间筛选边界与表内存储同为 UTC+8：
// 前端传 UTC（Z）边界时，SQLite 文本比较不能错位。
func TestListEventsNormalizesTimeFiltersToCST(t *testing.T) {
	db := newTestDB(t)
	cst := time.FixedZone("UTC+8", 8*3600)
	startsAt := time.Date(2026, 10, 25, 0, 30, 0, 0, cst)
	seedEvent(t, db, "tz-filter", models.AlertEventStatusFiring, startsAt, nil, nil)

	from := startsAt.UTC()
	_, total, err := ListEvents(db, ListQuery{Page: 1, PageSize: 20, StartsFrom: &from})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)

	before := startsAt.UTC().Add(-time.Minute)
	_, total, err = ListEvents(db, ListQuery{Page: 1, PageSize: 20, StartsTo: &before})
	require.NoError(t, err)
	assert.EqualValues(t, 0, total)
}

// TestWebhookHandlerAlways2xx 对 Alertmanager 永远 2xx：合法报文落库，畸形报文也只记日志。
func TestWebhookHandlerAlways2xx(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newTestDB(t)
	r := gin.New()
	r.POST(WebhookPath, WebhookHandler(NewService(db)))

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
