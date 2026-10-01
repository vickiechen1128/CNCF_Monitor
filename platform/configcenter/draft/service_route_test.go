package draft

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// rootRouteAlertmanagerYML 是一份含根兜底与用户具体分流的手写 alertmanager.yml
// （T08-10 挂载钩子串接测试基线）。
const rootRouteAlertmanagerYML = `route:
  receiver: user-default
  group_by: ['alertname']
  group_wait: 30s
  routes:
    - receiver: team-a
      matchers:
        - severity="critical"
receivers:
  - name: user-default
  - name: team-a
`

// seedAlertmanagerContent 造一条 applied 留痕的 alertmanager.yml 内容（M09 源数据只读输入）。
func seedAlertmanagerContent(t *testing.T, db *gorm.DB, content string) {
	t.Helper()
	require.NoError(t, db.Create(&models.AlertmanagerConfigVersion{
		Content:  content,
		Checksum: models.AlertmanagerConfigChecksum(content),
		Status:   models.AlertmanagerConfigStatusApplied,
	}).Error)
}

// seedChannel 造一条通知渠道（enabled 可控），返回其 ID。渠道名取中文（sanitize 后为空）
// 使 NotifyChannel.ReceiverName() 回落为 `notify-<id>`，便于断言平台 receiver 名。
func seedChannel(t *testing.T, db *gorm.DB, name string, enabled bool) uint {
	t.Helper()
	ch := &models.NotifyChannel{
		Name:       name,
		Type:       models.NotifyChannelTypeFeishu,
		WebhookURL: "https://open.feishu.cn/open-apis/bot/v2/hook/" + name,
		Enabled:    enabled,
	}
	require.NoError(t, db.Create(ch).Error)
	return ch.ID
}

// TestLoadRouteSetting_ZeroWhenMissing 覆盖 data_source.LoadRouteSetting：记录缺失返回
// 零值设定（nil = 不接管）且不报错。
func TestLoadRouteSetting_ZeroWhenMissing(t *testing.T) {
	db := newTestDB(t)

	s, err := generator.LoadRouteSetting(db)
	require.NoError(t, err, "缺失不得报错")
	require.NotNil(t, s)
	assert.Nil(t, s.DefaultReceiverChannelID, "零值 = 不接管")
	assert.Equal(t, models.DefaultDomainID, s.NetworkDomainID)

	chID := seedChannel(t, db, "平台兜底", true)
	require.NoError(t, db.Create(&models.AlertmanagerRouteSetting{
		NetworkDomainID:          models.DefaultDomainID,
		DefaultReceiverChannelID: &chID,
	}).Error)

	s, err = generator.LoadRouteSetting(db)
	require.NoError(t, err)
	require.NotNil(t, s.DefaultReceiverChannelID)
	assert.Equal(t, chID, *s.DefaultReceiverChannelID)
}

// TestMaterializeRootRouteReceiver_DisabledAndUnavailableKeepBytes 覆盖验收：设定未开启 /
// 渠道不可用 → 产物字节级不变（对存量零影响），且 checksum 一致。
func TestMaterializeRootRouteReceiver_DisabledAndUnavailableKeepBytes(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedAlertmanagerContent(t, db, rootRouteAlertmanagerYML)
	chID := seedChannel(t, db, "平台兜底", true)

	// 无设定（未开启）→ 产物不含平台物化 receiver 之外的改动。
	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	before, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	require.Contains(t, before.AlertmanagerYML, "receiver: user-default", "根兜底保持手写值")
	assert.False(t, before.RootRouteRebuilt)

	// 设定指向「已禁用」渠道 → 仍不接管（字节级不变、checksum 一致）。
	disabledID := seedChannel(t, db, "已停用", false)
	require.NoError(t, db.Create(&models.AlertmanagerRouteSetting{
		NetworkDomainID:          models.DefaultDomainID,
		DefaultReceiverChannelID: &disabledID,
	}).Error)
	after, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	assert.Equal(t, before.Checksum(), after.Checksum(), "渠道不可用 → checksum 不变")
	assert.False(t, after.RootRouteRebuilt)
	assert.Contains(t, after.AlertmanagerYML, "receiver: user-default")

	// 设定指向「已启用」渠道 → 接管生效（checksum 变化，根兜底被替换）。
	require.NoError(t, db.Model(&models.AlertmanagerRouteSetting{}).
		Where("network_domain_id = ?", models.DefaultDomainID).
		Update("default_receiver_channel_id", chID).Error)
	enabled, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	assert.NotEqual(t, before.Checksum(), enabled.Checksum(), "接管生效 → checksum 变化")
	assert.True(t, enabled.RootRouteRebuilt)
	assert.Contains(t, enabled.AlertmanagerYML, "receiver: notify-1", "根兜底被替换为平台默认接收人")

	// 用户具体分流不受影响（决策 113 红线）。
	assert.Contains(t, enabled.AlertmanagerYML, "receiver: team-a")
	assert.Contains(t, enabled.AlertmanagerYML, "group_wait: 30s")
}

// TestMaterializeRootRouteReceiver_NoRouteDegradesWithoutError 覆盖「文件无 route 节点 →
// 跳过 + 诊断，不返回 error」：挂载路径不因骨架而失败。
func TestMaterializeRootRouteReceiver_NoRouteDegradesWithoutError(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	noRoute := "receivers:\n  - name: notify-1\n"
	seedAlertmanagerContent(t, db, noRoute)
	chID := seedChannel(t, db, "平台兜底", true)
	require.NoError(t, db.Create(&models.AlertmanagerRouteSetting{
		NetworkDomainID:          models.DefaultDomainID,
		DefaultReceiverChannelID: &chID,
	}).Error)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	artifacts, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err, "骨架异常不得让挂载路径失败")
	assert.False(t, artifacts.RootRouteRebuilt, "无 route → 未替换")
	require.Len(t, artifacts.RootRouteDiagnostics, 1, "应给出跳过诊断")
	assert.Equal(t, generator.RootRouteSkipNoRoute, artifacts.RootRouteDiagnostics[0].Code)
}

// TestGenerateDraft_RootRouteRebuiltEmitsChangeItem 覆盖护栏②：根兜底被实际替换时，
// 变更清单出现一条显式「根兜底被平台重建」变更项。
func TestGenerateDraft_RootRouteRebuiltEmitsChangeItem(t *testing.T) {
	stubGeneratorTools(t)
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedHost(t, db, models.DefaultDomainID, "res-1")
	seedJob(t, db, models.DefaultDomainID, "center-job")
	seedAlertmanagerContent(t, db, rootRouteAlertmanagerYML)
	chID := seedChannel(t, db, "平台兜底", true)
	require.NoError(t, db.Create(&models.AlertmanagerRouteSetting{
		NetworkDomainID:          models.DefaultDomainID,
		DefaultReceiverChannelID: &chID,
	}).Error)

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	require.NotNil(t, d)
	assert.Contains(t, d.AlertmanagerYml, "receiver: notify-1")
	assert.Contains(t, d.ChangeItems, "根兜底被平台重建", "护栏②：变更单须明示根兜底被平台重建")
}

// TestGenerateDraft_NoRootRouteChangeNoChangeItem 覆盖反向：设定未开启时不产生
// 「根兜底被平台重建」变更项（存量零噪声）。
func TestGenerateDraft_NoRootRouteChangeNoChangeItem(t *testing.T) {
	stubGeneratorTools(t)
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedHost(t, db, models.DefaultDomainID, "res-1")
	seedJob(t, db, models.DefaultDomainID, "center-job")
	seedAlertmanagerContent(t, db, rootRouteAlertmanagerYML)

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	require.NotNil(t, d)
	assert.NotContains(t, d.ChangeItems, "根兜底被平台重建")
	assert.Contains(t, d.AlertmanagerYml, "receiver: user-default")
}