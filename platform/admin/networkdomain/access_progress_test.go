package networkdomain

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAccessStepOf(t *testing.T) {
	tests := []struct {
		name      string
		monitored bool
		online    bool
		want      int
	}{
		{"已登记（未纳管）", false, false, 1},
		{"已纳管", true, false, 2},
		{"节点已上线", true, true, 3},
		// note: hasOnline 优先于 isMonitored（节点上线隐含已纳管），孤儿 online 也按 3
		{"节点上线但未纳管标", false, true, 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := &models.NetworkDomain{IsMonitored: tt.monitored}
			assert.Equal(t, tt.want, AccessStepOf(d, tt.online))
		})
	}
}

func TestDomainListView_AggregatesOnlineAgents(t *testing.T) {
	db := openTestDB(t)

	domNotMonitored := &models.NetworkDomain{ID: "d-1", Name: "未纳管", TenantID: "platform_admin"}
	domMonitored := &models.NetworkDomain{ID: "d-2", Name: "已纳管无节点", TenantID: "platform_admin", IsMonitored: true}
	domOnline := &models.NetworkDomain{ID: "d-3", Name: "节点已上线", TenantID: "platform_admin", IsMonitored: true}
	for _, d := range []*models.NetworkDomain{domNotMonitored, domMonitored, domOnline} {
		require.NoError(t, db.Create(d).Error)
	}

	// d-3 下有一个 online agent；d-2 下有一个 offline agent（不算在线）。
	require.NoError(t, db.Create(&models.EdgeAgent{NetworkDomainID: "d-2", Status: models.EdgeAgentStatusOffline, Hostname: "h-off"}).Error)
	require.NoError(t, db.Create(&models.EdgeAgent{NetworkDomainID: "d-3", Status: models.EdgeAgentStatusOnline, Hostname: "h-on"}).Error)

	views, err := DomainListView(db, []models.NetworkDomain{*domNotMonitored, *domMonitored, *domOnline})
	require.NoError(t, err)
	byID := map[string]DomainListItemView{}
	for _, v := range views {
		byID[v.ID] = v
	}
	assert.Equal(t, 1, byID["d-1"].AccessStep)
	assert.False(t, byID["d-1"].HasOnlineAgents)
	assert.Equal(t, 2, byID["d-2"].AccessStep)
	assert.False(t, byID["d-2"].HasOnlineAgents, "offline agent 不计入在线")
	assert.Equal(t, 3, byID["d-3"].AccessStep)
	assert.True(t, byID["d-3"].HasOnlineAgents)
}

func TestDomainListView_EmptyList(t *testing.T) {
	db := openTestDB(t)
	views, err := DomainListView(db, nil)
	require.NoError(t, err)
	assert.NotNil(t, views)
	assert.Empty(t, views)
}