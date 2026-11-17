package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateRouteTree(t *testing.T) {
	allowed := map[string]bool{"default": true, "notify-c1": true}

	valid := []RouteNode{{
		ID: "root", Receiver: "default", Enabled: true,
		GroupWait: "30s",
		Children: []RouteNode{{ID: "child", Receiver: "notify-c1", Enabled: true}},
	}}
	assert.Empty(t, ValidateRouteTree(valid, allowed))

	cases := []struct {
		name  string
		tree  []RouteNode
		field string
	}{
		{"empty", nil, "route_tree"},
		{"two roots", append(valid, valid[0]), "route_tree"},
		{"missing receiver", []RouteNode{{ID: "root"}}, "root.receiver"},
		{"unknown receiver", []RouteNode{{ID: "root", Receiver: "notify-x"}}, "root.receiver"},
		{"bad duration", []RouteNode{{ID: "root", Receiver: "default", GroupWait: "soon"}}, "root.group_wait"},
		{"bad matcher", []RouteNode{{ID: "root", Receiver: "default",
			Matchers: []Matcher{{Name: "", Value: "x"}}}}, "root.matchers[0].name"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			issues := ValidateRouteTree(testCase.tree, allowed)
			if assert.NotEmpty(t, issues) {
				assert.Equal(t, testCase.field, issues[0].Field)
			}
		})
	}
}

func TestCollectReceiversSkipsDisabled(t *testing.T) {
	tree := []RouteNode{{
		ID: "root", Receiver: "default", Enabled: true,
		Children: []RouteNode{
			{ID: "on", Receiver: "notify-c1", Enabled: true},
			{ID: "off", Receiver: "notify-c2", Enabled: false},
		},
	}}
	receivers := CollectReceivers(tree)
	assert.True(t, receivers["default"])
	assert.True(t, receivers["notify-c1"])
	assert.False(t, receivers["notify-c2"])
}

func TestValidateWebhookURL(t *testing.T) {
	assert.NoError(t, ValidateWebhookURL("https://open.feishu.cn/open-apis/bot/v2/hook/abc", false))
	assert.Error(t, ValidateWebhookURL("http://127.0.0.1:8080/hook", false))
	assert.Error(t, ValidateWebhookURL("http://localhost/hook", false))
	assert.Error(t, ValidateWebhookURL("http://169.254.169.254/latest/meta-data", false))
	assert.Error(t, ValidateWebhookURL("http://10.0.0.1/hook", false))
	assert.NoError(t, ValidateWebhookURL("http://10.0.0.1/hook", true), "explicit allow-private flag")
	assert.Error(t, ValidateWebhookURL("ftp://example.com/hook", false))
}

func TestClosedStatusMapping(t *testing.T) {
	assert.Equal(t, EventStatusSilencedClosed, ClosedStatus(EventStatusSilenced))
	assert.Equal(t, EventStatusInhibitedClosed, ClosedStatus(EventStatusInhibited))
	assert.Equal(t, EventStatusResolved, ClosedStatus(EventStatusFiring))
	assert.Equal(t, EventStatusFiring, NormalizeStatus("weird"))
}
