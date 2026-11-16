package service_test

import (
	"context"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

type fakeCenterSource struct {
	rules []references.CenterRule
	fp    time.Time
}

func (f *fakeCenterSource) ListEnabledReady(context.Context) ([]references.CenterRule, error) {
	return f.rules, nil
}

func (f *fakeCenterSource) Fingerprint(context.Context) (time.Time, error) {
	return f.fp, nil
}

type recordingRuleSink struct {
	calls    int
	version  string
	outcomes map[string]string
}

func (r *recordingRuleSink) RecordDomainSync(context.Context, string, string, time.Time, map[string]string) error {
	return nil
}

func (r *recordingRuleSink) RecordRuleSync(_ context.Context, version string, _ time.Time, outcomes map[string]string) error {
	r.calls++
	r.version = version
	r.outcomes = outcomes
	return nil
}

func TestCenterRulesSyncPublishesAndWritesBack(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		Name:        "host",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}, fp: time.Now()}
	sink := &recordingRuleSink{}
	outputDir := t.TempDir()
	svc := service.NewCenterRulesService(repo, source, sink, outputDir, nil)
	svc.SetValidator(passed())

	snapshot, err := svc.Sync(context.Background())
	require.NoError(t, err)
	require.Equal(t, "passed", snapshot.ValidationStatus)
	assert.True(t, snapshot.IsCurrent)
	assert.Equal(t, 1, sink.calls)
	assert.Empty(t, sink.outcomes["rule-1"])

	raw, err := os.ReadFile(filepath.Join(outputDir, "rules.yml"))
	require.NoError(t, err)
	assert.Contains(t, string(raw), "HostDown")

	// Identical rules return the current snapshot without re-writing back.
	again, err := svc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, snapshot.ID, again.ID)
	assert.Equal(t, 1, sink.calls)
}

func TestCenterRulesReloadFailureKeepsCurrent(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}}
	sink := &recordingRuleSink{}
	deadURL, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	svc := service.NewCenterRulesService(repo, source, sink, t.TempDir(), deadURL)
	svc.SetValidator(passed())

	snapshot, err := svc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "failed", snapshot.ValidationStatus)
	assert.Equal(t, "platform_fault", snapshot.ValidationCause)
	require.NotEmpty(t, sink.outcomes["rule-1"])

	current, err := repo.CurrentPassed(context.Background())
	require.NoError(t, err)
	assert.Nil(t, current)
}
