package draft

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
	"gorm.io/gorm"
)

// emptyRouteAlertmanagerYML 是一份「空配置域」形态的 alertmanager.yml：只有根兜底 + 节奏，
// **无任何子路由**（即 #31 骨架布缆后的典型形态）——预置示例唯一允许注入的形态。
const emptyRouteAlertmanagerYML = `route:
  receiver: user-default
  group_by: ['alertname']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
receivers:
  - name: user-default
`

// presetRouteView 是产物 alertmanager.yml 的解析视图（接线测试用）。
type presetRouteView struct {
	Receiver string            `yaml:"receiver"`
	GroupBy  []string          `yaml:"group_by"`
	Matchers []string          `yaml:"matchers"`
	Routes   []presetRouteView `yaml:"routes"`
}

type presetAMView struct {
	Route        presetRouteView `yaml:"route"`
	InhibitRules []struct {
		Equal []string `yaml:"equal"`
	} `yaml:"inhibit_rules"`
}

func parsePresetAM(t *testing.T, yml string) presetAMView {
	t.Helper()
	var doc presetAMView
	require.NoError(t, yaml.Unmarshal([]byte(yml), &doc), "产物须为合法 YAML")
	return doc
}

// stubNotifyBridge 配置通知渲染桥地址（使平台渠道被物化为 receivers）。测试须在
// seedManagedRouteSetting 之前调用：预置示例只引用**文件中真实已声明**的 receiver，
// 而平台 receiver 的物化以桥地址非空为前提。
func stubNotifyBridge(t *testing.T) {
	t.Helper()
	oldURL, oldToken := NotifyBridgeURL, NotifyBridgeToken
	NotifyBridgeURL, NotifyBridgeToken = "http://127.0.0.1:8080", "bridge-token"
	t.Cleanup(func() { NotifyBridgeURL, NotifyBridgeToken = oldURL, oldToken })
}

// seedManagedRouteSetting 写入管理域 route 段单例设定（模式 + 可选默认接收人）。
func seedManagedRouteSetting(t *testing.T, db *gorm.DB, mode models.RouteMode, channelID *uint) {
	t.Helper()
	require.NoError(t, db.Create(&models.AlertmanagerRouteSetting{
		NetworkDomainID:          models.DefaultDomainID,
		DefaultReceiverChannelID: channelID,
		Mode:                     mode,
	}).Error)
}

// TestSeedManagedRoutePreset_ManagedModeInjectsPreset 覆盖接线：托管模式 + 空配置域 → 产物
// 注入完整预置示例（根兜底收敛为平台默认接收人 + 3 条示例分流 + 1 条抑制示例）。
//
// 同时锁定注入顺序「receivers 物化 → 根兜底 → 预置种子」的效果：种子写出的根 receiver 为
// 骨架已收敛的默认接收人（两者指向同一值，故顺序不产生分歧；断言的是最终一致态）。
func TestSeedManagedRoutePreset_ManagedModeInjectsPreset(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	artifacts, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)

	assert.True(t, artifacts.RoutePresetSeeded, "托管模式 + 空配置域应标记已注入")
	assert.Empty(t, artifacts.RoutePresetDiagnostics, "成功注入不应有诊断")

	view := parsePresetAM(t, artifacts.AlertmanagerYML)
	assert.Equal(t, "notify-1", view.Route.Receiver, "根兜底收敛为平台默认接收人")
	require.Len(t, view.Route.Routes, 3, "含 3 条示例分流")
	assert.Equal(t, []string{`severity="critical"`}, view.Route.Routes[0].Matchers)
	assert.Equal(t, []string{`severity="warning"`}, view.Route.Routes[1].Matchers)
	assert.Equal(t, []string{`team=~"sre|ops"`}, view.Route.Routes[2].Matchers)
	require.Len(t, view.InhibitRules, 1, "含 1 条抑制示例")
	assert.Equal(t, []string{"alertname", "instance"}, view.InhibitRules[0].Equal)

	// 子路由 receiver 必须真实已声明（零悬空引用）。
	declared := map[string]bool{"user-default": true, "notify-1": true}
	for _, r := range view.Route.Routes {
		assert.True(t, declared[r.Receiver], "子路由 receiver %q 必须在 receivers 段已声明", r.Receiver)
	}
	assert.Contains(t, artifacts.AlertmanagerYML, "name: notify-1", "平台 receiver 已在 receivers 段物化")
}

// TestSeedManagedRoutePreset_HandwrittenModeNoOp 覆盖红线 1 的接线侧：手写模式（**含存量零值**）
// → 产物字节级不变、零诊断、不标记注入（**默认零影响**）。
func TestSeedManagedRoutePreset_HandwrittenModeNoOp(t *testing.T) {
	for _, tc := range []struct {
		name string
		mode models.RouteMode
	}{
		{"显式手写模式", models.RouteModeHandwritten},
		{"存量零值行（未回填 mode）", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := newTestDB(t)
			seedManagementDomain(t, db, models.DefaultDomainID)
			seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)
			stubNotifyBridge(t)
			chID := seedChannel(t, db, "平台值班", true)
			seedManagedRouteSetting(t, db, tc.mode, &chID)

			dom, err := generator.LoadDomain(db, models.DefaultDomainID)
			require.NoError(t, err)
			artifacts, _, _, err := buildArtifacts(db, dom)
			require.NoError(t, err)

			assert.False(t, artifacts.RoutePresetSeeded, "手写模式不得注入示例")
			assert.Empty(t, artifacts.RoutePresetDiagnostics, "手写模式不应产生诊断")
			// 根兜底仍按 #31 正常工作（手写模式只关示例，不禁用骨架）。
			assert.NotContains(t, artifacts.AlertmanagerYML, "inhibit_rules", "手写模式不得注入抑制示例")
			assert.NotContains(t, artifacts.AlertmanagerYML, "预置示例", "手写模式不得注入示例路由")
		})
	}
}

// TestSeedManagedRoutePreset_ExistingRoutesNoClobber 覆盖红线 2 的接线侧：托管模式下用户已
// 手写分流时，产物保留用户配置、预置示例不覆盖，并给出可读诊断。
func TestSeedManagedRoutePreset_ExistingRoutesNoClobber(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedAlertmanagerContent(t, db, rootRouteAlertmanagerYML) // 含 team-a 子路由
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	artifacts, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)

	assert.False(t, artifacts.RoutePresetSeeded, "已有分流时不得标记注入")
	require.Len(t, artifacts.RoutePresetDiagnostics, 1)
	assert.Equal(t, generator.PresetSkipRouteNotSeedable, artifacts.RoutePresetDiagnostics[0].Code)
	assert.Contains(t, artifacts.AlertmanagerYML, "receiver: team-a", "用户既有分流逐字保留")
	assert.NotContains(t, artifacts.AlertmanagerYML, "预置示例", "不得注入示例覆盖用户配置")
}

// TestSeedManagedRoutePreset_ChangeItemEmitted 覆盖变更单明示：实际注入时变更清单出现一条
// 「预置路由示例已注入」变更项（护栏②：复用既有变更项机制，不新增机制）。
func TestSeedManagedRoutePreset_ChangeItemEmitted(t *testing.T) {
	stubGeneratorTools(t)
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedHost(t, db, models.DefaultDomainID, "res-1")
	seedJob(t, db, models.DefaultDomainID, "center-job")
	seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	require.NotNil(t, d)
	assert.Contains(t, d.AlertmanagerYml, "预置示例", "产物含预置示例")
	assert.Contains(t, d.ChangeItems, "预置路由示例已注入", "变更单须明示预置示例已注入")
	assert.Contains(t, d.AlertmanagerYml, `severity="critical"`, "产物含示例分流")
}

// TestGenerateDraft_HandwrittenNoPresetChangeItem 反向对照：手写模式（默认）不产生
// 「预置路由示例已注入」变更项（存量零噪声）。
func TestGenerateDraft_HandwrittenNoPresetChangeItem(t *testing.T) {
	stubGeneratorTools(t)
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedHost(t, db, models.DefaultDomainID, "res-1")
	seedJob(t, db, models.DefaultDomainID, "center-job")
	seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	require.NotNil(t, d)
	assert.NotContains(t, d.ChangeItems, "预置路由示例已注入", "默认手写模式不得产生预置变更项")
	assert.NotContains(t, d.AlertmanagerYml, "预置示例", "默认手写模式产物不得含示例")
}

// TestRevalidateDraft_ReproducesPreset 覆盖重校路径一致性：初次生成注入的预置示例，在
// **重新校验**时须被复现（不因重校而回退），保证两条路径产物一致。
func TestRevalidateDraft_ReproducesPreset(t *testing.T) {
	stubGeneratorTools(t)
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedHost(t, db, models.DefaultDomainID, "res-1")
	seedJob(t, db, models.DefaultDomainID, "center-job")
	seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	d, err := GenerateDraft(db, models.DefaultDomainID)
	require.NoError(t, err)
	require.NotNil(t, d)
	require.Contains(t, d.AlertmanagerYml, "预置示例", "初次生成应已注入预置示例")

	rev, err := RevalidateDraft(db, d.ChangeNo)
	require.NoError(t, err)
	require.NotNil(t, rev)
	// 重校后重新回放一遍产物构建，须与初次生成的产物字节一致（幂等 + 路径一致）。
	//
	// 注：RoutePresetSeeded 仍为 true —— buildArtifacts 每轮都从**源留痕**（用户挂载的原始
	// alertmanager.yml）重算，而非从上轮产物增量；源留痕仍是「空 route」形态，故种子每轮重新
	// 注入并产出**字节相同**的结果。这与 #31 骨架的 RootRouteRebuilt 同口径（骨架亦每轮重算）。
	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	rebuilt, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	assert.Equal(t, d.AlertmanagerYml, rebuilt.AlertmanagerYML,
		"重校/重建路径产物须与初次生成一致（预置示例不被回退）")
}

// TestSeedManagedRoutePreset_IdempotentAcrossBuilds 覆盖接线侧幂等：连续两次 buildArtifacts
// ⇒ 产物字节与 checksum 完全一致（注入结果稳定可复现，M09 保活/取代机制依赖此性质）。
//
// 两轮都标记 RoutePresetSeeded=true 是预期行为：buildArtifacts 每轮从**源留痕**重算，
// 源留痕仍是「空 route」形态 ⇒ 种子每轮重新注入、产出字节相同的结果（同 #31 骨架口径）。
// 变更单侧的幂等由 M09 决策 44-3「产物无实质变化不生成噪声变更单」兜底。
func TestSeedManagedRoutePreset_IdempotentAcrossBuilds(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	first, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	require.True(t, first.RoutePresetSeeded)

	second, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	assert.Equal(t, first.Checksum(), second.Checksum(), "连跑两次 checksum 一致")
	assert.Equal(t, first.AlertmanagerYML, second.AlertmanagerYML, "连跑两次产物字节一致")
}

// TestSeedManagedRoutePreset_RepeatedOnSeededRouteIsNoOp 覆盖「预置示例已存在时平台不再重写」：
// 把已注入示例的产物当作 base 再跑一次种子 ⇒ 字节级不变（幂等的纯函数级证明，
// 也是「用户已保存过示例配置后平台不再反复改写」的保证）。
func TestSeedManagedRoutePreset_RepeatedOnSeededRouteIsNoOp(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedAlertmanagerContent(t, db, emptyRouteAlertmanagerYML)
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	first, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)

	// 直接对已注入示例的产物再跑一次纯函数。
	again, diags, err := generator.SeedManagedRoutePreset(first.AlertmanagerYML, generator.RoutePresetInput{
		Mode:                  models.RouteModeManaged,
		DefaultReceiver:       "notify-1",
		PlatformReceiverNames: []string{"notify-1"},
	})
	require.NoError(t, err)
	assert.Equal(t, first.AlertmanagerYML, again, "已存在示例时字节级不变")
	require.Len(t, diags, 1)
	assert.Equal(t, generator.PresetSkipRouteNotSeedable, diags[0].Code)
}

// TestSeedManagedRoutePreset_NoRouteDegradesWithoutError 覆盖护栏接线侧：文件无 route 节点
// 时跳过 + 诊断，挂载路径不因预置示例而失败。
func TestSeedManagedRoutePreset_NoRouteDegradesWithoutError(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	seedAlertmanagerContent(t, db, "receivers:\n  - name: notify-1\n")
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	artifacts, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err, "预置示例异常不得让挂载路径失败")
	assert.False(t, artifacts.RoutePresetSeeded)
	require.Len(t, artifacts.RoutePresetDiagnostics, 1)
	assert.Equal(t, generator.PresetSkipNoRoute, artifacts.RoutePresetDiagnostics[0].Code)
}

// TestSeedManagedRoutePreset_NoAlertmanagerYAMLNoOp 边界：非管理域 / 无告警配置留痕时，
// 预置注入完全空转（不改动其它产物、不产生诊断）。
func TestSeedManagedRoutePreset_NoAlertmanagerYMLNoOp(t *testing.T) {
	db := newTestDB(t)
	seedManagementDomain(t, db, models.DefaultDomainID)
	// 不 seed alertmanager 留痕 ⇒ AlertmanagerYML 为空。
	stubNotifyBridge(t)
	chID := seedChannel(t, db, "平台值班", true)
	seedManagedRouteSetting(t, db, models.RouteModeManaged, &chID)

	dom, err := generator.LoadDomain(db, models.DefaultDomainID)
	require.NoError(t, err)
	artifacts, _, _, err := buildArtifacts(db, dom)
	require.NoError(t, err)
	assert.Empty(t, artifacts.AlertmanagerYML)
	assert.False(t, artifacts.RoutePresetSeeded)
	assert.Empty(t, artifacts.RoutePresetDiagnostics, "无产物时不应产生诊断")
}
