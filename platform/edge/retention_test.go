package edge

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func seedHeartbeatAt(t *testing.T, db *gorm.DB, domainID string, at time.Time) {
	t.Helper()
	require.NoError(t, db.Create(&models.EdgeHeartbeat{
		NetworkDomainID: domainID,
		AgentType:       models.AgentTypeVMAgent,
		Timestamp:       at,
	}).Error)
}

func TestPurgeHeartbeatsRetentionBoundary(t *testing.T) {
	db := newEdgeTestDB(t)
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	seedHeartbeatAt(t, db, "edge-a", now.AddDate(0, 0, -8))
	seedHeartbeatAt(t, db, "edge-a", now.AddDate(0, 0, -7))
	seedHeartbeatAt(t, db, "edge-b", now.AddDate(0, 0, -9))
	seedHeartbeatAt(t, db, "edge-b", now.Add(-time.Hour))

	deleted, err := purgeHeartbeats(db, now, 7, 100000, 1)
	require.NoError(t, err)
	assert.EqualValues(t, 2, deleted)

	var remaining []models.EdgeHeartbeat
	require.NoError(t, db.Unscoped().Order("id").Find(&remaining).Error)
	require.Len(t, remaining, 2)
	assert.Equal(t, "edge-a", remaining[0].NetworkDomainID)
	assert.Equal(t, "edge-b", remaining[1].NetworkDomainID)
}

func TestPurgeHeartbeatsCapsEachDomainIndependently(t *testing.T) {
	db := newEdgeTestDB(t)
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 7; i++ {
		seedHeartbeatAt(t, db, "edge-a", now.Add(time.Duration(i)*time.Second))
	}
	for i := 0; i < 3; i++ {
		seedHeartbeatAt(t, db, "edge-b", now.Add(time.Duration(i)*time.Second))
	}

	deleted, err := purgeHeartbeats(db, now, 7, 3, 2)
	require.NoError(t, err)
	assert.EqualValues(t, 4, deleted)

	for domainID, want := range map[string]int64{"edge-a": 3, "edge-b": 3} {
		var count int64
		require.NoError(t, db.Unscoped().Model(&models.EdgeHeartbeat{}).
			Where("network_domain_id = ?", domainID).Count(&count).Error)
		assert.Equal(t, want, count, domainID)
	}
	var oldest models.EdgeHeartbeat
	require.NoError(t, db.Unscoped().Where("network_domain_id = ?", "edge-a").Order("id").First(&oldest).Error)
	assert.Equal(t, now.Add(4*time.Second), oldest.Timestamp)
}

func TestPurgeHeartbeatsNilDB(t *testing.T) {
	deleted, err := PurgeHeartbeats(nil, time.Now(), 7)
	require.NoError(t, err)
	assert.Zero(t, deleted)
}

func TestHeartbeatRetentionDaysFromEnv(t *testing.T) {
	for _, tc := range []struct {
		value string
		want  int
	}{
		{value: "", want: 7},
		{value: "30", want: 30},
		{value: "0", want: 7},
		{value: "invalid", want: 7},
	} {
		t.Run(fmt.Sprintf("value_%s", tc.value), func(t *testing.T) {
			t.Setenv("EDGE_HEARTBEAT_RETENTION_DAYS", tc.value)
			assert.Equal(t, tc.want, heartbeatRetentionDaysFromEnv())
		})
	}
}

func TestStartHeartbeatRetentionStopsWithContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	StartHeartbeatRetention(ctx, nil)
}
