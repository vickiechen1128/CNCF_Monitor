package edge

import (
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestHeartbeatBootstrapsBlankAgentPullDomain：空白 agent_pull 网域首次心跳时，中心
// 自动补一份零 Job 空配置版本并返回 config_changed=true；后续心跳版本一致不再拉包。
func TestHeartbeatBootstrapsBlankAgentPullDomain(t *testing.T) {
	db := newEdgeTestDB(t)
	// 引导会走 M09 生成链路（jobs/rules/源数据版本）并落草稿，补齐所需表。
	for _, m := range []interface{}{
		&models.ScrapeJob{},
		&models.MonitoringRule{},
		&models.LabelTemplate{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.InterfaceService{},
		&models.CITypeExporterMapping{},
		&models.NotifyChannel{},
		&models.NotifyTemplate{},
		&models.ConfigDraft{},
	} {
		require.NoError(t, db.AutoMigrate(m))
	}

	dom := seedEdgeDomain(db, "edge-blank", "agent_pull", "tok-blank", "vmagent", "http://center:8080")
	require.NoError(t, db.Model(&models.NetworkDomain{}).
		Where("id = ?", dom.ID).Update("is_monitored", true).Error)
	dom.IsMonitored = true

	svc := NewHeartbeatService(db)
	now := time.Now()

	resp, err := svc.Handle(dom, &HeartbeatRequest{
		NetworkDomainID: dom.ID,
		AgentType:       models.AgentTypeVMAgent,
	}, now, "http://center:8080")
	require.NoError(t, err)
	assert.True(t, resp.ConfigChanged, "首次心跳应下发自动引导的空配置版本")
	assert.NotEmpty(t, resp.ConfigVersion)
	assert.Contains(t, resp.ConfigDownloadURL, "/api/v2/platform/edge/config")

	var version models.ConfigVersion
	require.NoError(t, db.Where("network_domain_id = ?", dom.ID).First(&version).Error)
	assert.Contains(t, version.PrometheusYml, "scrape_configs:")
	assert.NotContains(t, version.PrometheusYml, "job_name")

	// 第二次心跳：agent 已上报该版本 → 不再重复拉包。
	resp2, err := svc.Handle(dom, &HeartbeatRequest{
		NetworkDomainID: dom.ID,
		AgentType:       models.AgentTypeVMAgent,
		ConfigVersion:   resp.ConfigVersion,
	}, now.Add(30*time.Second), "http://center:8080")
	require.NoError(t, err)
	assert.False(t, resp2.ConfigChanged)
}

// TestHeartbeatDoesNotBootstrapUnmonitoredDomain：未纳管网域不触发引导，保持现状。
func TestHeartbeatDoesNotBootstrapUnmonitoredDomain(t *testing.T) {
	db := newEdgeTestDB(t)
	dom := seedEdgeDomain(db, "edge-unmonitored", "agent_pull", "tok-unmonitored", "vmagent", "http://center:8080")

	svc := NewHeartbeatService(db)
	resp, err := svc.Handle(dom, &HeartbeatRequest{
		NetworkDomainID: dom.ID,
		AgentType:       models.AgentTypeVMAgent,
	}, time.Now(), "http://center:8080")
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged)

	var count int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).
		Where("network_domain_id = ?", dom.ID).Count(&count).Error)
	assert.Zero(t, count)
}
