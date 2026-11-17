package configgen

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/models"
)

func TestGenerateRendersDeterministicArtifacts(t *testing.T) {
	now := time.Date(2026, 11, 11, 10, 0, 0, 0, time.UTC)
	src := Source{
		NetworkDomainID: "mc-demo",
		ZoneType:        "beijing",
		Jobs: []Job{{
			Name:    "node",
			Targets: []Target{{Instance: "10.0.0.2:9100"}, {Instance: "10.0.0.1:9100"}},
		}},
	}
	first, err := Generate(src, "20261111-100000", now)
	require.NoError(t, err)
	second, err := Generate(src, "20261111-100000", now)
	require.NoError(t, err)

	assert.Equal(t, first.Checksum, second.Checksum, "same source renders the same checksum")
	assert.Equal(t, "20261111-100000", first.Version)
	assert.Contains(t, first.PrometheusYML, "network_domain_id: mc-demo")
	assert.Contains(t, first.PrometheusYML, "zone_type: beijing")
	assert.Contains(t, first.PrometheusYML, "job_name: node")
	assert.NotContains(t, first.PrometheusYML, "rule_files", "edge domains carry no rules")

	require.Contains(t, first.TargetsFiles, "node.json")
	targets := first.TargetsFiles["node.json"]
	assert.True(t, strings.Index(targets, "10.0.0.1:9100") < strings.Index(targets, "10.0.0.2:9100"),
		"targets are sorted for stable output")
	assert.Contains(t, first.Metadata, `"config_version":"20261111-100000"`)
	assert.Contains(t, first.Metadata, `"agent_type":"vmagent"`)
	assert.Contains(t, first.Metadata, first.Checksum)
}

func TestGenerateEmptyDomainIsValid(t *testing.T) {
	artifacts, err := Generate(Source{NetworkDomainID: "mc-empty"}, "20261111-100000", time.Unix(0, 0))
	require.NoError(t, err)
	assert.Contains(t, artifacts.PrometheusYML, "scrape_configs: []")
	assert.Empty(t, artifacts.TargetsFiles)
	assert.NotEmpty(t, artifacts.Checksum)
}

func TestGenerateGroupsTargetsByLabels(t *testing.T) {
	artifacts, err := Generate(Source{
		NetworkDomainID: "mc-demo",
		Jobs: []Job{{
			Name: "mixed",
			Targets: []Target{
				{Instance: "1.1.1.1:9100", Labels: map[string]string{"env": "PRD"}},
				{Instance: "2.2.2.2:9100", Labels: map[string]string{"env": "PRD"}},
				{Instance: "3.3.3.3:9100", Labels: map[string]string{"env": "DEV"}},
			},
		}},
	}, "v1", time.Unix(0, 0))
	require.NoError(t, err)
	content := artifacts.TargetsFiles["mixed.json"]
	assert.Equal(t, 2, strings.Count(content, `"targets"`), "identical labels share one group")
}

func TestGenerateRequiresDomainAndVersion(t *testing.T) {
	_, err := Generate(Source{}, "v1", time.Unix(0, 0))
	assert.Error(t, err)
	_, err = Generate(Source{NetworkDomainID: "mc-demo"}, "", time.Unix(0, 0))
	assert.Error(t, err)
}

func TestGenerateCenterRules(t *testing.T) {
	rules := []models.MonitoringRule{{
		ContentMode: models.RuleContentModeYAMLPassthrough,
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
		Enabled:     true,
		DraftStatus: "ready",
		Scope:       models.ScopeTypeCentral,
	}}
	artifacts, err := GenerateCenterRules(rules, "v1", time.Now())
	require.NoError(t, err)
	assert.NotEmpty(t, artifacts.Checksum)
	assert.Contains(t, artifacts.RulesYML, "HostDown")
	assert.Contains(t, artifacts.PrometheusYML, "rule_files")
	assert.Contains(t, artifacts.PrometheusYML, "rules.yml")

	empty, err := GenerateCenterRules(nil, "v2", time.Now())
	require.NoError(t, err)
	assert.Empty(t, empty.RulesYML)
}

func TestGenerateRendersEnabledBlackboxModules(t *testing.T) {
	src := Source{
		NetworkDomainID: "mc-demo",
		ZoneType:        "beijing",
		Modules: []models.BlackboxModule{{
			Name: "http_2xx", Content: "http_2xx:\n  prober: http\n  timeout: 5s\n", Enabled: true,
		}},
		Jobs: []Job{{
			Name:           "api-probe",
			BlackboxModule: "http_2xx",
			Targets:        []Target{{Instance: "http://10.0.0.1:8080/health"}},
		}},
	}
	artifacts, err := Generate(src, "v1", time.Now())
	require.NoError(t, err)
	assert.Contains(t, artifacts.BlackboxYML, "http_2xx:")
	assert.Contains(t, artifacts.PrometheusYML, "__param_target")
}
