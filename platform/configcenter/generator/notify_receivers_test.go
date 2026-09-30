package generator

import (
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const baseAMYAML = `global:
  resolve_timeout: 5m
route:
  receiver: default
  routes:
    - matchers:
        - severity="critical"
      receiver: default
receivers:
  - name: default
    webhook_configs:
      - url: 'https://example.com/default'
`

func chWithID(id uint, name string) models.NotifyChannel {
	return models.NotifyChannel{BaseModel: models.BaseModel{ID: id}, Name: name, Type: models.NotifyChannelTypeFeishu, Enabled: true}
}

// TestMaterializeNotifyReceiversAppendsPlatformReceiver 覆盖物化 happy path：
// 保留手写 receiver、追加平台 receiver（url 带 channel 数字 ID + http_config Bearer 令牌）。
func TestMaterializeNotifyReceiversAppendsPlatformReceiver(t *testing.T) {
	out, conflicts, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		BridgeToken: "inner-token",
		Channels:    []models.NotifyChannel{chWithID(7, "SRE-Critical")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts)

	// 手写 receiver 透传保留。
	assert.Contains(t, out, "name: default")
	assert.Contains(t, out, "https://example.com/default")
	// 平台 receiver：名 sanitize、url 只带 channel、令牌走 http_config.authorization。
	assert.Contains(t, out, "name: sre-critical")
	assert.Contains(t, out, "http://127.0.0.1:8080/api/v1/webhooks/notify?channel=7")
	assert.NotContains(t, out, "token=", "令牌绝不落 URL query（H-1）")
	assert.Contains(t, out, "authorization:")
	assert.Contains(t, out, "type: Bearer")
	assert.Contains(t, out, "credentials: inner-token")

	// 幂等：对已物化结果再物化一次，不重复追加、不误判重名。
	out2, conflicts2, err := MaterializeNotifyReceivers(out, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		BridgeToken: "inner-token",
		Channels:    []models.NotifyChannel{chWithID(7, "SRE-Critical")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts2, "已物化的平台 receiver 不应被判为重名")
	assert.Equal(t, 1, strings.Count(out2, "name: sre-critical"), "不得重复追加同名 receiver")
}

// TestMaterializeNotifyReceiversOmitsHTTPConfigWithoutToken 令牌为空时不写
// http_config.authorization（绝不伪造占位令牌进入真实下发配置）。
func TestMaterializeNotifyReceiversOmitsHTTPConfigWithoutToken(t *testing.T) {
	out, conflicts, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL: "http://127.0.0.1:8080",
		Channels:  []models.NotifyChannel{chWithID(3, "ops")},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts)
	assert.Contains(t, out, "name: ops")
	assert.Contains(t, out, "?channel=3")
	assert.NotContains(t, out, "authorization:")
}

// TestMaterializeReceiverEmitsTemplateParam 渠道绑定了模板 → receiver URL 追加
// `&template=<真实数字 ID>`（渠道 ↔ 模板一等绑定，dev-feedback #30 §5.3）；未绑定则只带 channel。
func TestMaterializeReceiverEmitsTemplateParam(t *testing.T) {
	bound := uint(42)
	ch := chWithID(7, "SRE-Critical")
	ch.DefaultTemplateID = &bound
	out, conflicts, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		BridgeToken: "inner-token",
		Channels:    []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts)
	assert.Contains(t, out, "?channel=7&template=42", "绑定渠道须在 receiver URL 带 template 参数")

	unbound, _, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL: "http://127.0.0.1:8080", BridgeToken: "t",
		Channels: []models.NotifyChannel{chWithID(8, "ops")},
	})
	require.NoError(t, err)
	assert.Contains(t, unbound, "?channel=8")
	assert.NotContains(t, unbound, "template=", "未绑定不得写 template 参数（回落内置默认）")
}

// TestMaterializeReceiverBindingChangeViaAddressEvolution 绑定新增/变化时，平台 receiver
// 走「地址演进原地更新」：不误报重名、不重复追加、不残留旧地址——绑定随之持久，不被重算覆写。
func TestMaterializeReceiverBindingChangeViaAddressEvolution(t *testing.T) {
	out, _, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL: "http://127.0.0.1:8080", BridgeToken: "t",
		Channels: []models.NotifyChannel{chWithID(7, "SRE-Critical")},
	})
	require.NoError(t, err)
	require.Contains(t, out, "?channel=7")

	bound := uint(42)
	ch := chWithID(7, "SRE-Critical")
	ch.DefaultTemplateID = &bound
	updated, conflicts, err := MaterializeNotifyReceivers(out, NotifyReceiverInput{
		BridgeURL: "http://127.0.0.1:8080", BridgeToken: "t",
		Channels: []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	assert.Empty(t, conflicts, "同一平台 receiver 的地址演进不得误报重名")
	assert.Contains(t, updated, "?channel=7&template=42")
	assert.Equal(t, 1, strings.Count(updated, "name: sre-critical"), "原地更新，不重复追加")
	assert.Equal(t, 1, strings.Count(updated, "channel=7"), "旧地址应被原地更新、不残留")
}

// TestMaterializeNotifyReceiversNoop 基座为空 / 桥地址为空 / 无渠道时原样返回。
func TestMaterializeNotifyReceiversNoop(t *testing.T) {
	for _, tc := range []struct {
		name string
		base string
		in   NotifyReceiverInput
	}{
		{"空基座", "", NotifyReceiverInput{BridgeURL: "http://x:8080", Channels: []models.NotifyChannel{chWithID(1, "a")}}},
		{"桥地址空", baseAMYAML, NotifyReceiverInput{Channels: []models.NotifyChannel{chWithID(1, "a")}}},
		{"无渠道", baseAMYAML, NotifyReceiverInput{BridgeURL: "http://x:8080"}},
	} {
		out, conflicts, err := MaterializeNotifyReceivers(tc.base, tc.in)
		require.NoErrorf(t, err, tc.name)
		assert.Emptyf(t, conflicts, tc.name)
		assert.Equalf(t, tc.base, out, tc.name)
	}
}

// TestMaterializeNotifyReceiversHandwrittenNameConflict 平台名与手写 receiver 重名 →
// 不写入任何平台 receiver、返回冲突归因（含手写行号），绝不静默覆盖。
func TestMaterializeNotifyReceiversHandwrittenNameConflict(t *testing.T) {
	base := `route:
  receiver: sre
receivers:
  - name: sre
    webhook_configs:
      - url: 'https://handwritten.example/hook'
`
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		BridgeToken: "tok",
		Channels:    []models.NotifyChannel{chWithID(1, "SRE")},
	})
	require.NoError(t, err)
	require.Len(t, conflicts, 1)
	assert.Equal(t, "sre", conflicts[0].Name)
	assert.Greater(t, conflicts[0].Line, 0, "冲突须给出手写 receiver 行号")
	assert.Equal(t, base, out, "存在冲突时不得做任何写入（避免半合并）")
	assert.NotContains(t, out, "/api/v1/webhooks/notify")
}

// TestMaterializeNotifyReceiversInternalDuplicate 平台内部两条渠道 sanitize 同名 → 冲突
// （AM 拒绝重复 receiver 名），不写入。
func TestMaterializeNotifyReceiversInternalDuplicate(t *testing.T) {
	out, conflicts, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		BridgeToken: "tok",
		Channels:    []models.NotifyChannel{chWithID(1, "Ops"), chWithID(2, "ops")},
	})
	require.NoError(t, err)
	require.Len(t, conflicts, 1)
	assert.Equal(t, "ops", conflicts[0].Name)
	assert.Equal(t, baseAMYAML, out)
}

// TestValidateArtifactsNotifyReceiverConflict 冲突经校验层转为 failed + user_config +
// alertmanager.yml 行级错误（确定性用户配置缺陷，不因工具缺失退化为 pending）。
func TestValidateArtifactsNotifyReceiverConflict(t *testing.T) {
	ca := &ConfigArtifacts{
		AlertmanagerYML:         baseAMYAML,
		NotifyReceiverConflicts: []NotifyReceiverConflict{{Name: "sre", Line: 6}},
	}
	status, cause, details, msg := ValidateArtifacts(ca, false, nil)
	assert.Equal(t, models.ValidationStatusFailed, status)
	assert.Equal(t, models.ValidationCauseUserConfig, cause)
	require.Len(t, details, 1)
	assert.Equal(t, "alertmanager.yml", details[0].File)
	assert.Equal(t, 6, details[0].Line)
	assert.Contains(t, details[0].Message, "sre")
	assert.NotEmpty(t, msg)
}

// TestMaterializeNotifyReceiversBridgeURLChangeUpdatesInPlace 覆盖 L2：桥基础地址从 A 变到 B
// 时，已物化的平台 receiver 视为自身产物（同名且 URL 属平台桥地址形态）→ 地址演进原地更新其
// url 与 http_config.authorization，不报重名、不重复追加、不产生 failed+user_config（决策 74
// 定稿补充；对应 M09 F-36 止血）。
func TestMaterializeNotifyReceiversBridgeURLChangeUpdatesInPlace(t *testing.T) {
	ch := chWithID(1, "腾讯云边缘域-飞书") // sanitize 后为空 → ReceiverName() = notify-1

	// 先用地址 A 物化一次，得到含 notify-1（url=A）的草稿产物。
	outA, conflictsA, err := MaterializeNotifyReceivers(baseAMYAML, NotifyReceiverInput{
		BridgeURL:   "http://bridge-a.example:8080",
		BridgeToken: "tok-a",
		Channels:    []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	require.Empty(t, conflictsA)
	urlA := "http://bridge-a.example:8080/api/v1/webhooks/notify?channel=1"
	require.Contains(t, outA, "name: notify-1")
	require.Contains(t, outA, urlA)

	// 再把桥地址改为 B 重校：应原地更新为 url=B，不冲突、不重复追加。
	outB, conflictsB, err := MaterializeNotifyReceivers(outA, NotifyReceiverInput{
		BridgeURL:   "http://bridge-b.example:8080",
		BridgeToken: "tok-b",
		Channels:    []models.NotifyChannel{ch},
	})
	require.NoError(t, err)
	assert.Empty(t, conflictsB, "桥地址演进不应判为重名冲突")
	urlB := "http://bridge-b.example:8080/api/v1/webhooks/notify?channel=1"
	assert.Contains(t, outB, urlB, "应原地更新为地址 B")
	assert.NotContains(t, outB, urlA, "旧地址不应残留")
	assert.Equal(t, 1, strings.Count(outB, "name: notify-1"), "不得重复追加同名 receiver")
	assert.Contains(t, outB, "credentials: tok-b", "http_config.authorization 应同步更新为 B 的令牌")
}

// TestMaterializeNotifyReceiversHandwrittenSquatStillConflicts 覆盖 L2 反例：用户手写 receiver
// 与平台槽位同名，但其 url 指向非平台桥地址（确系用户手写、指向别处）→ 仍判
// failed+user_config + 行级错误（决策 74「绝不静默覆盖/合并」语义不变）。
func TestMaterializeNotifyReceiversHandwrittenSquatStillConflicts(t *testing.T) {
	base := `route:
  receiver: notify-1
receivers:
  - name: notify-1
    webhook_configs:
      - url: 'https://handwritten.example/hook'
`
	out, conflicts, err := MaterializeNotifyReceivers(base, NotifyReceiverInput{
		BridgeURL:   "http://127.0.0.1:8080",
		BridgeToken: "tok",
		Channels:    []models.NotifyChannel{chWithID(1, "腾讯云边缘域-飞书")}, // → notify-1
	})
	require.NoError(t, err)
	require.Len(t, conflicts, 1)
	assert.Equal(t, "notify-1", conflicts[0].Name)
	assert.Greater(t, conflicts[0].Line, 0, "冲突须给出手写 receiver 行号")
	assert.Equal(t, base, out, "存在真重名冲突时不得做任何写入（避免半合并）")
	assert.NotContains(t, out, "/api/v1/webhooks/notify")
}
