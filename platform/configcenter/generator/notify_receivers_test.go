package generator

import (
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func chWithID(id uint, name string) models.NotifyChannel {
	return models.NotifyChannel{
		BaseModel: models.BaseModel{ID: id},
		Name:      name,
		Type:      models.NotifyChannelTypeFeishu,
	}
}

// baseWithReferenced 构造一个最小 alertmanager.yml，route 段引用给定 receiver 名。
func baseWithReferenced(names ...string) string {
	var b strings.Builder
	b.WriteString("route:\n  receiver: default\n")
	if len(names) > 0 {
		b.WriteString("  routes:\n")
		for _, n := range names {
			b.WriteString("    - receiver: " + n + "\n")
		}
	}
	b.WriteString("receivers:\n  - name: default\n    webhook_configs:\n      - url: 'https://example.com/default'\n")
	return b.String()
}

// TestCollectRouteReceiverNames 覆盖根路由 + 嵌套子路由的 receiver 收集。
func TestCollectRouteReceiverNames(t *testing.T) {
	base := `route:
  receiver: default
  routes:
    - receiver: notify-1
      routes:
        - receiver: notify-2
`
	got, err := CollectRouteReceiverNames(base)
	require.NoError(t, err)
	assert.Contains(t, got, "default")
	assert.Contains(t, got, "notify-1")
	assert.Contains(t, got, "notify-2")
	assert.Len(t, got, 3)
}

// TestMaterializeNotifyReceiversOnlyReferenced 只物化被 route 段引用的渠道：
// 未被引用的渠道不进入 yml，因此新增渠道本身不会触发配置变更。
func TestMaterializeNotifyReceiversOnlyReferenced(t *testing.T) {
	base := baseWithReferenced("notify-7")
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{chWithID(7, "SRE-Critical"), chWithID(8, "未使用渠道")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts)

	assert.Contains(t, out, "name: default")
	assert.Contains(t, out, "name: notify-7")
	assert.NotContains(t, out, "name: notify-8", "未被路由引用的渠道不得物化")
	assert.Contains(t, out, "http://127.0.0.1:8080/api/v1/webhooks/notify?id=7")
	assert.NotContains(t, out, "token=", "令牌绝不落 URL query（H-1）")

	// 幂等：再物化一次不重复追加。
	out2, conflicts2, err := MaterializeNotifyReceivers(out, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{chWithID(7, "SRE-Critical"), chWithID(8, "未使用渠道")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts2)
	assert.Equal(t, 1, strings.Count(out2, "name: notify-7"))
}

// TestMaterializeNotifyReceiversRemovesUnreferencedPlatformReceiver 路由不再引用某渠道时，
// 清理其平台 receiver（用户手写 receiver 保留）。
func TestMaterializeNotifyReceiversRemovesUnreferencedPlatformReceiver(t *testing.T) {
	base := `route:
  receiver: notify-7
receivers:
  - name: notify-7
    webhook_configs:
      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?id=7'
  - name: notify-8
    webhook_configs:
      - url: 'http://127.0.0.1:8080/api/v1/webhooks/notify?id=8'
  - name: handwritten
    webhook_configs:
      - url: 'https://example.com/handwritten'
`
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{chWithID(7, "SRE"), chWithID(8, "Ops")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts)
	assert.Contains(t, out, "name: notify-7")
	assert.NotContains(t, out, "name: notify-8", "不再被引用的平台 receiver 应移除")
	assert.Contains(t, out, "name: handwritten", "用户手写 receiver 必须保留")
}

// TestMaterializeReceiverOmitsTemplateParam 模板绑定不写进 receiver URL：
// 换绑模板是纯 DB 操作，桥在投递时按 channel ID 实时解析。
func TestMaterializeReceiverOmitsTemplateParam(t *testing.T) {
	bound := uint(42)
	ch := chWithID(7, "SRE-Critical")
	ch.DefaultTemplateID = &bound
	out, _, err := MaterializeNotifyReceivers(baseWithReferenced("notify-7"), NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "?id=7")
	assert.NotContains(t, out, "template=", "模板 ID 不进入 alertmanager.yml")
}

// TestMaterializeNotifyReceiversBridgeURLChangeUpdatesInPlace 桥基础地址变化时，
// 已物化的平台 receiver 原地更新，不重复追加。
func TestMaterializeNotifyReceiversBridgeURLChangeUpdatesInPlace(t *testing.T) {
	ch := chWithID(1, "飞书渠道")
	base := baseWithReferenced("notify-1")

	outA, conflictsA, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://bridge-a.example:8080",
		Channels:    []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	require.Empty(t, conflictsA)
	urlA := "http://bridge-a.example:8080/api/v1/webhooks/notify?id=1"
	require.Contains(t, outA, urlA)

	outB, conflictsB, err := MaterializeNotifyReceivers(outA, NotifyReceiverInput{
		BridgeURL:   "http://bridge-b.example:8080",
		Channels:    []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	assert.Empty(t, conflictsB)
	urlB := "http://bridge-b.example:8080/api/v1/webhooks/notify?id=1"
	assert.Contains(t, outB, urlB)
	assert.NotContains(t, outB, urlA)
	assert.Equal(t, 1, strings.Count(outB, "name: notify-1"))
}

// TestMaterializeNotifyReceiversHandwrittenSquatConflicts 用户手写同名 receiver
// （非平台桥地址）与已引用渠道冲突 → 不写入任何平台 receiver。
func TestMaterializeNotifyReceiversHandwrittenSquatConflicts(t *testing.T) {
	base := `route:
  receiver: notify-1
receivers:
  - name: notify-1
    webhook_configs:
      - url: 'https://handwritten.example/hook'
`
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{chWithID(1, "飞书渠道")},
	})
	require.NoError(t, err)
	require.Len(t, conflicts, 1)
	assert.Equal(t, "notify-1", conflicts[0].Name)
	assert.Greater(t, conflicts[0].Line, 0)
	assert.Equal(t, base, out, "存在冲突时不得做任何写入")
	assert.NotContains(t, out, "/api/v1/webhooks/notify")
}

// TestMaterializeNotifyReceiversNameOnlyShellFillsInPlace name-only 残壳按平台槽位原地补齐。
func TestMaterializeNotifyReceiversNameOnlyShellFillsInPlace(t *testing.T) {
	base := `route:
  receiver: notify-1
  routes:
    - matchers:
        - severity="critical"
      receiver: notify-1
receivers:
  - name: notify-1
  - name: feishu
`
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{chWithID(1, "飞书渠道")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts)
	assert.Equal(t, 1, strings.Count(out, "name: notify-1"))
	assert.Contains(t, out, "http://127.0.0.1:8080/api/v1/webhooks/notify?id=1")
	assert.Contains(t, out, "name: feishu", "非平台命名空间的 name-only receiver 原样保留")
	assert.Contains(t, out, "severity=\"critical\"")
}

// TestMaterializeNotifyReceiversNonWebhookHandwrittenStillConflicts 带 email_configs 的
// 同名 receiver 仍是用户手写，必须保持冲突。
func TestMaterializeNotifyReceiversNonWebhookHandwrittenStillConflicts(t *testing.T) {
	base := `route:
  receiver: notify-1
receivers:
  - name: notify-1
    email_configs:
      - to: sre@example.com
`
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		Channels:    []models.NotifyChannel{chWithID(1, "飞书渠道")},
	})
	require.NoError(t, err)
	require.Len(t, conflicts, 1)
	assert.Equal(t, "notify-1", conflicts[0].Name)
	assert.Equal(t, base, out)
}

// TestMaterializeNotifyReceiversNoop 基座为空 / 桥地址为空 / 无渠道时原样返回。
func TestMaterializeNotifyReceiversNoop(t *testing.T) {
	for _, tc := range []struct {
		name string
		base string
		in   NotifyReceiverInput
	}{
		{"空基座", "", NotifyReceiverInput{BridgeURL: "http://x:8080", Channels: []models.NotifyChannel{chWithID(1, "a")}}},
		{"桥地址空", baseWithReferenced("notify-1"), NotifyReceiverInput{Channels: []models.NotifyChannel{chWithID(1, "a")}}},
		{"无渠道", baseWithReferenced("notify-1"), NotifyReceiverInput{BridgeURL: "http://x:8080"}},
	} {
		out, conflicts, err := MaterializeNotifyReceivers(tc.base, tc.in)
		require.NoErrorf(t, err, tc.name)
		assert.Emptyf(t, conflicts, tc.name)
		assert.Equalf(t, tc.base, out, tc.name)
	}
}

// TestValidateArtifactsNotifyReceiverConflict 冲突经校验层转为 failed + user_config + 行级错误。
func TestValidateArtifactsNotifyReceiverConflict(t *testing.T) {
	ca := &ConfigArtifacts{
		AlertmanagerYML:         baseWithReferenced("notify-1"),
		NotifyReceiverConflicts: []NotifyReceiverConflict{{Name: "notify-1", Line: 6}},
	}
	status, cause, details, msg := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause)
	require.Len(t, details, 1)
	assert.Equal(t, "alertmanager.yml", details[0].File)
	assert.Equal(t, 6, details[0].Line)
	assert.Contains(t, details[0].Message, "notify-1")
	assert.NotEmpty(t, msg)
}
