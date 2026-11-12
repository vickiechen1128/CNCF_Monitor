package configgen

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
