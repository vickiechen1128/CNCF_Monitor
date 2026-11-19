package configgen

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configcenter/generator"
)

func TestValidateCenterRulesUsesPlatformJobs(t *testing.T) {
	oldLookPath := generator.ToolLookPath
	oldChecker := generator.ToolChecker
	generator.ToolLookPath = func(string) (string, error) { return "promtool", nil }
	generator.ToolChecker = func(*generator.ConfigArtifacts, bool) (generator.ToolCheckStatus, string) {
		return generator.ToolCheckPassed, ""
	}
	t.Cleanup(func() {
		generator.ToolLookPath = oldLookPath
		generator.ToolChecker = oldChecker
	})

	artifacts, err := GenerateCenterRules([]models.MonitoringRule{{
		ContentMode: models.RuleContentModeYAMLPassthrough,
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up{job=\"node\"} == 0\n",
		Enabled:     true,
		DraftStatus: "ready",
		Scope:       models.ScopeTypeCentral,
	}}, "20260101-0000", time.Now(), "")
	require.NoError(t, err)

	passed := Validate(artifacts, []string{"node"})
	assert.Equal(t, string(models.ValidationStatusPassed), passed.Status)
	assert.Equal(t, "none", passed.Cause)

	failed := Validate(artifacts, nil)
	assert.Equal(t, string(models.ValidationStatusFailed), failed.Status)
	assert.Equal(t, string(models.ValidationCauseUserConfig), failed.Cause)
}
