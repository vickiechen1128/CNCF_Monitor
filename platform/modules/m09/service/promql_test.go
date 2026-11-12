package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

const testMatcher = `network_domain_id=~"mc-a|mc-b"`

func TestInjectDomain(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"bare selector", "up", "up{" + testMatcher + "}"},
		{"selector with labels", `up{job="node"}`, `up{job="node",` + testMatcher + `}`},
		{"function arg", `rate(node_cpu_seconds_total{mode="idle"}[5m])`,
			`rate(node_cpu_seconds_total{mode="idle",` + testMatcher + `}[5m])`},
		{"aggregation by label", `sum by (job) (rate(http_requests_total[5m]))`,
			`sum by (job) (rate(http_requests_total{` + testMatcher + `}[5m]))`},
		{"name-only selector", `{__name__="up"}`, `{__name__="up",` + testMatcher + `}`},
		{"no selector", "1 + 2", "1 + 2"},
		{"string literal untouched", `label_replace(up, "dst", "x", "src", ".*")`,
			`label_replace(up{` + testMatcher + `}, "dst", "x", "src", ".*")`},
		{"empty", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, InjectDomain(tc.in, testMatcher))
		})
	}
}

func TestInjectDomainDoesNotTouchLabelNames(t *testing.T) {
	got := InjectDomain(`sum without (instance, pod) (container_cpu_usage_seconds_total)`, testMatcher)
	assert.Contains(t, got, "without (instance, pod)")
	assert.NotContains(t, got, "instance{")
	assert.NotContains(t, got, "pod{")
	assert.Contains(t, got, "container_cpu_usage_seconds_total{"+testMatcher+"}")
}

func TestInjectMatcher(t *testing.T) {
	assert.Equal(t, []string{"{" + testMatcher + "}"}, InjectMatcher(nil, testMatcher))
	assert.Equal(t, []string{"{" + testMatcher + "}"}, InjectMatcher([]string{""}, testMatcher))
	assert.Equal(t, []string{`{job="node",` + testMatcher + `}`},
		InjectMatcher([]string{`{job="node"}`}, testMatcher))
	merged := InjectMatcher([]string{"up"}, testMatcher)
	assert.Equal(t, "up{"+testMatcher+"}", merged[0])
}

func TestDomainMatcher(t *testing.T) {
	assert.Equal(t, `network_domain_id=~"mc-a|mc-b"`, DomainMatcher([]string{"mc-a", "mc-b"}))
	assert.Equal(t, `network_domain_id=~""`, DomainMatcher(nil), "authorized to nothing matches nothing")
	assert.True(t, strings.HasPrefix(DomainMatcher([]string{"", " "}), `network_domain_id=~""`))
}
