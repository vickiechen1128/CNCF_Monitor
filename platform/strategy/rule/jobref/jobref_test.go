package jobref

import (
	"testing"

	"github.com/stretchr/testify/require"
)

const fixture = `
groups:
- name: host-alerts
  rules:
  - alert: HostDown
    expr: absent(up{job="ceshi"})
  - alert: HighCPU
    expr: node_cpu_usage{job="linux"} > 0.9
  - record: job:node:ok
    expr: sum(up{job=~"node|node-exporter|linux"})
`

func TestValidateMatchesExistingJobs(t *testing.T) {
	// ceshi / linux / node 、node-exporter 都存在 → 无任何问题。
	issues := Validate(fixture, []string{"ceshi", "linux", "node", "node-exporter"})
	require.Empty(t, issues)
}

func TestValidateLiteralMissingIsWarning(t *testing.T) {
	// 非存活类规则精确引用缺失 job → warning（liveness 规则才 error）。
	content := `
groups:
- name: g
  rules:
  - alert: HighCPU
    expr: node_cpu_usage{job="mysql"} > 0.9
`
	issues := Validate(content, []string{"ceshi"})
	require.Len(t, issues, 1)
	it := issues[0]
	require.Equal(t, SeverityWarning, it.Severity)
	require.Equal(t, "mysql", it.ReferencedJob)
	require.Equal(t, "literal", it.Type)
	require.Equal(t, "HighCPU", it.RuleName)
}

func TestValidateUpIsError(t *testing.T) {
	// 存活类规则（absent(up)）精确引用缺失 job "down" → error。
	content := `
groups:
- name: g
  rules:
  - alert: Down
    expr: absent(up{job="down"})
`
	issues := Validate(content, []string{"upok"})
	require.Len(t, issues, 1)
	require.Equal(t, SeverityError, issues[0].Severity)
	require.Equal(t, "down", issues[0].ReferencedJob)
}

func TestValidateRegexMissingIsErrorForUp(t *testing.T) {
	// absent(up{job=~"node"}) 引用的正则未命中任何 job → error。
	content := `
groups:
- name: g
  rules:
  - alert: NodesDown
    expr: absent(up{job=~"node|node-exporter"})
`
	issues := Validate(content, []string{"ceshi", "linux"})
	require.Len(t, issues, 1)
	require.Equal(t, SeverityError, issues[0].Severity)
	require.Equal(t, "regex", issues[0].Type)
	require.Equal(t, "node|node-exporter", issues[0].ReferencedJob)
}

func TestValidateRegexMatchesAnyJob(t *testing.T) {
	// 正则 node-exporter 命中 node-exporter job → 无问题。
	content := `
groups:
- name: g
  rules:
  - alert: N
    expr: absent(up{job=~"node-exporter"})
`
	require.Empty(t, Validate(content, []string{"node-exporter", "linux"}))
}

func TestValidateInvalidYAMLReturnsNil(t *testing.T) {
	require.Nil(t, Validate("not: yaml: [", []string{"ceshi"}))
	require.Nil(t, Validate("", nil))
}

func TestValidateNoJobMatcherSkips(t *testing.T) {
	content := `
groups:
- name: g
  rules:
  - alert: Plain
    expr: node_cpu_usage > 0.9
`
	require.Empty(t, Validate(content, []string{}))
}

func TestValidateDedupesRepeatedMatcher(t *testing.T) {
	// 同一 expr 多次引用同一缺失 job → 只报一次。
	content := `
groups:
- name: g
  rules:
  - alert: Dup
    expr: up{job="miss"} == 0 and (up{job="miss"} > 0)
`
	issues := Validate(content, []string{"existing"})
	require.Len(t, issues, 1)
}