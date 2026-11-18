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
		effective bool
		want      int
	}{
		{"已登记（未纳管）", false, false, false, 1},
		{"已纳管", true, false, false, 2},
		{"节点已上线", true, true, false, 3},
		// note: hasOnline 优先于 isMonitored（节点上线隐含已纳管），孤儿 online 也按 3
		{"节点上线但未纳管标", false, true, false, 3},
		{"已出数据（已生效采集任务）", true, true, true, 4},
		// note: 已生效采集任务蕴含已纳管 + 已下发，孤儿 job 也按 4
		{"已生效采集任务但未纳管标", false, false, true, 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := &models.NetworkDomain{IsMonitored: tt.monitored}
			assert.Equal(t, tt.want, AccessStepOf(d, tt.online, tt.effective))
		})
	}
}

// effectiveJobFixture 造一条「已生效」采集任务：enabled + draft=ready + deployed。
// 任一维度由 mutate 覆写即偏离生效态。
func effectiveJobFixture(name, domainID string, mutate func(*models.ScrapeJob)) *models.ScrapeJob {
	j := &models.ScrapeJob{
		JobName:         name,
		JobType:         models.JobTypeStandard,
		ResourceType:    models.ResourceTypeHost,
		NetworkDomainID: domainID,
		DraftStatus:     "ready",
		ChangeStatus:    models.ChangeStatusDeployed,
		Enabled:         true,
	}
	if mutate != nil {
		mutate(j)
	}
	return j
}

// TestEffectiveScrapeJobDomainIDs_Filters 锁定「已生效」的三重条件：
// enabled / draft_status=ready / change_status=deployed 缺一即不算数。
func TestEffectiveScrapeJobDomainIDs_Filters(t *testing.T) {
	db := openTestDB(t)

	all := []models.NetworkDomain{
		{ID: "d-hit", Name: "生效", TenantID: "platform_admin", IsMonitored: true},
		{ID: "d-disabled-job", Name: "任务停用", TenantID: "platform_admin", IsMonitored: true},
		{ID: "d-draft", Name: "草稿未定稿", TenantID: "platform_admin", IsMonitored: true},
		{ID: "d-pending", Name: "变更未下发", TenantID: "platform_admin", IsMonitored: true},
		{ID: "d-none", Name: "无任务", TenantID: "platform_admin", IsMonitored: true},
	}
	for i := range all {
		require.NoError(t, db.Create(&all[i]).Error)
	}

	jobs := []*models.ScrapeJob{
		effectiveJobFixture("job-hit", "d-hit", nil),
		effectiveJobFixture("job-disabled", "d-disabled-job", func(j *models.ScrapeJob) { j.Enabled = false }),
		effectiveJobFixture("job-draft", "d-draft", func(j *models.ScrapeJob) { j.DraftStatus = "draft" }),
		effectiveJobFixture("job-pending", "d-pending", func(j *models.ScrapeJob) { j.ChangeStatus = models.ChangeStatusPending }),
	}
	for _, j := range jobs {
		require.NoError(t, db.Create(j).Error)
	}

	got, err := effectiveScrapeJobDomainIDs(db, all)
	require.NoError(t, err)
	assert.True(t, got["d-hit"], "enabled+ready+deployed 应判定为已生效")
	assert.False(t, got["d-disabled-job"], "任务停用不算已生效")
	assert.False(t, got["d-draft"], "草稿未定稿不算已生效")
	assert.False(t, got["d-pending"], "变更未下发不算已生效")
	assert.False(t, got["d-none"], "无任务不算已生效")
}

// TestEffectiveScrapeJobDomainIDs_EmptyList 空入参短路，不打 DB。
func TestEffectiveScrapeJobDomainIDs_EmptyList(t *testing.T) {
	db := openTestDB(t)
	got, err := effectiveScrapeJobDomainIDs(db, nil)
	require.NoError(t, err)
	assert.Empty(t, got)
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

// TestDomainListView_Step4 回归：域下已有生效采集任务时应派生为第 4 态「已出数据」，
// 而非停留在第 3 态继续提示「去配置采集任务」。
func TestDomainListView_Step4(t *testing.T) {
	db := openTestDB(t)

	domData := &models.NetworkDomain{ID: "d-data", Name: "已出数据", TenantID: "platform_admin", IsMonitored: true}
	domNoData := &models.NetworkDomain{ID: "d-no-data", Name: "未出数据", TenantID: "platform_admin", IsMonitored: true}
	for _, d := range []*models.NetworkDomain{domData, domNoData} {
		require.NoError(t, db.Create(d).Error)
	}
	require.NoError(t, db.Create(&models.EdgeAgent{NetworkDomainID: "d-data", Status: models.EdgeAgentStatusOnline, Hostname: "h-1"}).Error)
	require.NoError(t, db.Create(&models.EdgeAgent{NetworkDomainID: "d-no-data", Status: models.EdgeAgentStatusOnline, Hostname: "h-2"}).Error)
	// d-data 有生效任务；d-no-data 的任务停用，仍应停在第 3 态。
	require.NoError(t, db.Create(effectiveJobFixture("job-a", "d-data", nil)).Error)
	require.NoError(t, db.Create(effectiveJobFixture("job-b", "d-no-data", func(j *models.ScrapeJob) { j.Enabled = false })).Error)

	views, err := DomainListView(db, []models.NetworkDomain{*domData, *domNoData})
	require.NoError(t, err)
	byID := map[string]DomainListItemView{}
	for _, v := range views {
		byID[v.ID] = v
	}
	assert.Equal(t, 4, byID["d-data"].AccessStep, "已有生效采集任务应判定为已出数据")
	assert.Equal(t, 3, byID["d-no-data"].AccessStep, "任务停用仍为节点已上线")
}

func TestDomainListView_EmptyList(t *testing.T) {
	db := openTestDB(t)
	views, err := DomainListView(db, nil)
	require.NoError(t, err)
	assert.NotNil(t, views)
	assert.Empty(t, views)
}