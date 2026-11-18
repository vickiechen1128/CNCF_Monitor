package generator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInhibitRulesBuildAndRoundTrip(t *testing.T) {
	setBridgeURL(t, "")
	disabled := false
	rules := []InhibitionRule{{
		ID: "inhibit-1", Name: "严重故障抑制一般告警",
		SourceMatchers: []RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}},
		TargetMatchers: []RouteEditMatcher{{Name: "severity", Value: "warning|info", IsEqual: true, IsRegex: true}},
		Equal:          []string{"network_domain", "instance"},
	}, {
		ID: "inhibit-2", Name: "禁用规则", Enabled: &disabled,
		SourceMatchers: []RouteEditMatcher{{Name: "alertname", Value: "A", IsEqual: true}},
		TargetMatchers: []RouteEditMatcher{{Name: "alertname", Value: "B", IsEqual: true}},
	}}
	out, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{
		RouteSection: routeSectionFor(t, buildTree()),
		InhibitRules: rules,
	})
	require.NoError(t, err)
	assert.Contains(t, out, "inhibit_rules:")
	assert.Contains(t, out, `severity="critical"`)
	assert.Contains(t, out, `severity=~"warning|info"`)
	assert.Contains(t, out, "# 抑制规则名称: 严重故障抑制一般告警")
	assert.NotContains(t, out, "禁用规则")

	parsed, err := ParseInhibitRules(out)
	require.NoError(t, err)
	require.Len(t, parsed, 1)
	assert.Equal(t, "inhibit-1", parsed[0].ID)
	assert.Equal(t, "严重故障抑制一般告警", parsed[0].Name)
	assert.Equal(t, rules[0].SourceMatchers, parsed[0].SourceMatchers)
	assert.Equal(t, rules[0].TargetMatchers, parsed[0].TargetMatchers)
	assert.Equal(t, rules[0].Equal, parsed[0].Equal)
	require.NotNil(t, parsed[0].Enabled)
	assert.True(t, *parsed[0].Enabled)
}

func TestParseInhibitRulesRejectsInvalidMatcher(t *testing.T) {
	_, err := ParseInhibitRules(`inhibit_rules:
  - source_matchers: ['severity="critical"']
    target_matchers: [123]
`)
	require.Error(t, err)
}
