package notify

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// renderFixture 构造覆盖告警 / 恢复两态的 AM webhook 载荷。
func renderFixture(status string) amWebhookPayload {
	return amWebhookPayload{
		Version:  "4",
		GroupKey: `{}:{alertname="HighCPU"}`,
		Status:   status,
		Receiver: "sre-critical",
		Alerts: []amWebhookAlert{{
			Status: status,
			Labels: map[string]string{
				"alertname": "HighCPU", "instance": "10.0.0.1:9100", "zone": "dmz", "severity": "critical",
			},
			Annotations: map[string]string{"summary": "cpu high", "description": "cpu > 90%"},
			StartsAt:    time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
			EndsAt:      time.Date(2026, 1, 2, 4, 4, 5, 0, time.UTC),
		}},
	}
}

// TestRenderBuiltinFeishuCardTemplate 覆盖内置默认飞书卡片模板渲染：产出合法 JSON、
// status 决定 header 配色（firing→red / resolved→green）、字段对齐用户脚本。
func TestRenderBuiltinFeishuCardTemplate(t *testing.T) {
	out, err := Render(BuiltinFeishuCardTemplate, renderFixture("firing"), DefaultRenderLocation)
	require.NoError(t, err)
	assert.True(t, json.Valid(out), "渲染结果须为合法 JSON：%s", string(out))

	var card struct {
		MsgType string `json:"msg_type"`
		Card    struct {
			Header struct {
				Template string `json:"template"`
			} `json:"header"`
		} `json:"card"`
	}
	require.NoError(t, json.Unmarshal(out, &card))
	assert.Equal(t, "interactive", card.MsgType)
	assert.Equal(t, "red", card.Card.Header.Template)

	// 字段对齐用户脚本（alertname/instance/zone/severity/summary/description）。
	s := string(out)
	assert.Contains(t, s, "HighCPU")
	assert.Contains(t, s, "10.0.0.1:9100")
	assert.Contains(t, s, `cpu \u003e 90%`)

	// 恢复态 → header 绿。
	out, err = Render(BuiltinFeishuCardTemplate, renderFixture("resolved"), DefaultRenderLocation)
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(out, &card))
	assert.Equal(t, "green", card.Card.Header.Template)
}

// TestRenderLocalizesTimeToRenderZone 覆盖时间本地化：模板内 StartsAtLocal / EndsAtLocal
// 按渲染时区（默认东八区固定偏移）格式化，不依赖宿主机时区。
func TestRenderLocalizesTimeToRenderZone(t *testing.T) {
	out, err := Render(BuiltinFeishuCardTemplate, renderFixture("firing"), nil) // nil → 东八区
	require.NoError(t, err)
	s := string(out)
	// 03:04:05Z + 8h = 11:04:05+08:00；04:04:05Z + 8h = 12:04:05+08:00。
	assert.Contains(t, s, "2026-01-02 11:04:05 +08:00")
	assert.Contains(t, s, "2026-01-02 12:04:05 +08:00")

	// 自定义时区（UTC）→ 偏移随渲染时区变化。
	out, err = Render(BuiltinFeishuCardTemplate, renderFixture("firing"), time.UTC)
	require.NoError(t, err)
	assert.Contains(t, string(out), "2026-01-02 03:04:05 +00:00")
}

// TestRenderRejectsEmptyOutput 覆盖「模板仅含 define 却未在根处调用」的空产出：
// 返回 ErrRenderEmpty，避免静默发送空体。
func TestRenderRejectsEmptyOutput(t *testing.T) {
	_, err := Render(`{{ define "feishu.card" }}hi{{ end }}`, renderFixture("firing"), nil)
	assert.ErrorIs(t, err, ErrRenderEmpty)
}

// TestDecodeWebhookInvalid 非法 JSON 载荷被拒。
func TestDecodeWebhookInvalid(t *testing.T) {
	_, err := decodeWebhook([]byte("not-json"))
	assert.Error(t, err)
}

// TestRenderUsesSharedFuncMap 覆盖「校验即渲染」：渲染侧与校验侧共用 jsonStr 等函数。
func TestRenderUsesSharedFuncMap(t *testing.T) {
	out, err := Render(`{"q": {{ jsonStr (toUpper "abc") }}}`, amWebhookPayload{}, nil)
	require.NoError(t, err)
	assert.JSONEq(t, `{"q": "ABC"}`, string(out))
}