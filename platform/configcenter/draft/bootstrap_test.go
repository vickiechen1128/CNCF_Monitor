package draft

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEnsureBootstrapVersionCreatesEmptyConfigVersion：空白 agent_pull 网域自动生成
// 并确认一份零 Job 空配置版本，产物满足边缘 agent 的结构校验。
func TestEnsureBootstrapVersionCreatesEmptyConfigVersion(t *testing.T) {
	db := newMemDB(t)
	// dispatchVersion 会回写 EdgeAgent 的 pull_pending 状态；本包 newMemDB 未迁移该表。
	require.NoError(t, db.AutoMigrate(&models.EdgeAgent{}))
	seedMonitoredDomain(t, db, "edge-empty", true)

	v, err := EnsureBootstrapVersion(db, "edge-empty")
	require.NoError(t, err)
	require.NotNil(t, v)
	assert.Equal(t, "edge-empty", v.NetworkDomainID)
	assert.Contains(t, v.PrometheusYml, "scrape_configs:")
	assert.NotContains(t, v.PrometheusYml, "job_name")
	assert.Empty(t, v.RulesYml)
	assert.Empty(t, v.BlackboxYml)

	var draftCount int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ?", "edge-empty").Count(&draftCount).Error)
	assert.EqualValues(t, 1, draftCount)

	var d models.ConfigDraft
	require.NoError(t, db.Where("network_domain_id = ?", "edge-empty").First(&d).Error)
	assert.Equal(t, models.DraftStatusConfirmed, d.Status)
	assert.Equal(t, BootstrapConfirmedBy, d.ConfirmedBy)
	assert.Equal(t, BootstrapSummary, d.Summary)

	var versionCount int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).
		Where("network_domain_id = ?", "edge-empty").Count(&versionCount).Error)
	assert.EqualValues(t, 1, versionCount)
}

// TestEnsureBootstrapVersionIdempotent：已有版本后不再生成。
func TestEnsureBootstrapVersionIdempotent(t *testing.T) {
	db := newMemDB(t)
	require.NoError(t, db.AutoMigrate(&models.EdgeAgent{}))
	seedMonitoredDomain(t, db, "edge-idem", true)

	v, err := EnsureBootstrapVersion(db, "edge-idem")
	require.NoError(t, err)
	require.NotNil(t, v)

	v2, err := EnsureBootstrapVersion(db, "edge-idem")
	require.NoError(t, err)
	assert.Nil(t, v2, "existing version should skip bootstrap")

	var versionCount int64
	require.NoError(t, db.Model(&models.ConfigVersion{}).
		Where("network_domain_id = ?", "edge-idem").Count(&versionCount).Error)
	assert.EqualValues(t, 1, versionCount)
}

// TestEnsureBootstrapVersionSkipsNonEligibleDomains：未纳管 / 冻结 / local 通道不引导。
func TestEnsureBootstrapVersionSkipsNonEligibleDomains(t *testing.T) {
	db := newMemDB(t)

	seedMonitoredDomain(t, db, "edge-unmonitored", false)
	v, err := EnsureBootstrapVersion(db, "edge-unmonitored")
	require.NoError(t, err)
	assert.Nil(t, v)

	seedMonitoredDomain(t, db, "edge-disabled", true)
	require.NoError(t, db.Model(&models.NetworkDomain{}).
		Where("id = ?", "edge-disabled").Update("status", models.DomainStatusDisabled).Error)
	v, err = EnsureBootstrapVersion(db, "edge-disabled")
	require.NoError(t, err)
	assert.Nil(t, v)

	local := &models.NetworkDomain{
		ID:          "local-domain",
		Name:        "local",
		DomainType:  models.DomainTypeManagement,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		Channel:     models.ChannelTypeLocal,
		IsMonitored: true,
	}
	require.NoError(t, db.Create(local).Error)
	v, err = EnsureBootstrapVersion(db, "local-domain")
	require.NoError(t, err)
	assert.Nil(t, v)
}

// TestEnsureBootstrapVersionSkipsWhenVersionExists：已有真实版本时不做任何事。
func TestEnsureBootstrapVersionSkipsWhenVersionExists(t *testing.T) {
	db := newMemDB(t)
	seedMonitoredDomain(t, db, "edge-has-version", true)
	require.NoError(t, db.Create(&models.ConfigVersion{
		NetworkDomainID: "edge-has-version",
		DraftID:         "existing",
		ChangeNo:        "CHG-EXISTING",
		PrometheusYml:   "global:\nscrape_configs:\n  - job_name: x\n",
	}).Error)

	v, err := EnsureBootstrapVersion(db, "edge-has-version")
	require.NoError(t, err)
	assert.Nil(t, v)
}
