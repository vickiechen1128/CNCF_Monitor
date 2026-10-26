package history

import (
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestPurgeExpiredKeepsOpenAndRecentRows 保留清理只删过期终态，未结行与近期终态保留。
func TestPurgeExpiredKeepsOpenAndRecentRows(t *testing.T) {
	db := newTestDB(t)
	now := time.Date(2026, 10, 25, 10, 0, 0, 0, time.UTC)

	oldStart := now.AddDate(0, 0, -400)
	oldClosed := now.AddDate(0, 0, -200)
	recentClosed := now.AddDate(0, 0, -10)

	// 一年前开始、现在仍未结束：永不清理。
	seedEvent(t, db, "open-old", models.AlertEventStatusFiring, oldStart, nil, nil)
	// 200 天前关闭：过期，删除。
	seedEvent(t, db, "resolved-old", models.AlertEventStatusResolved, oldStart, &oldClosed, &oldClosed)
	seedEvent(t, db, "lost-old", models.AlertEventStatusLost, oldStart, nil, &oldClosed)
	// 10 天前关闭：保留。
	seedEvent(t, db, "resolved-recent", models.AlertEventStatusResolved, oldStart, &recentClosed, &recentClosed)
	// 缺 closed_at 的终态（异常存量）：不删，留给迁移/排查。
	seedEvent(t, db, "resolved-no-close", models.AlertEventStatusResolved, oldStart, nil, nil)

	n, err := PurgeExpired(db, now, defaultRetentionDays)
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)

	assert.EqualValues(t, 3, countEvents(t, db))
	for _, fp := range []string{"open-old", "resolved-recent", "resolved-no-close"} {
		var cnt int64
		require.NoError(t, db.Model(&models.AlertEvent{}).Where("fingerprint = ?", fp).Count(&cnt).Error)
		assert.EqualValues(t, 1, cnt, "应保留 %s", fp)
	}
}
