package service_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

type capturingValidator struct {
	result configgen.ValidationResult
	jobs   []string
}

func (v *capturingValidator) Validate(_ context.Context, _ *configgen.Artifacts, platformJobs []string) configgen.ValidationResult {
	v.jobs = platformJobs
	return v.result
}

type fakeCenterSource struct {
	mu    sync.Mutex
	rules []references.CenterRule
	jobs  []string
	fp    time.Time
	calls int
}

func (f *fakeCenterSource) EffectiveJobNames(context.Context) ([]string, error) {
	return f.jobs, nil
}

func (f *fakeCenterSource) ListEnabledReady(context.Context) ([]references.CenterRule, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	return f.rules, nil
}

func (f *fakeCenterSource) Calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
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

	// Identical rules return the current snapshot; the writeback is repeated to
	// heal a stale M01 pending state, but no new version is created.
	again, err := svc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, snapshot.ID, again.ID)
	assert.Equal(t, 2, sink.calls)
}

func TestCenterRulesReloadFailureKeepsCurrent(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}}
	sink := &recordingRuleSink{}
	outputDir := t.TempDir()
	passSvc := service.NewCenterRulesService(repo, source, sink, outputDir, nil)
	passSvc.SetValidator(passed())
	first, err := passSvc.Sync(context.Background())
	require.NoError(t, err)
	require.Equal(t, "passed", first.ValidationStatus)

	// A later content change fails to reload; the passed current version must
	// stay current and no failed snapshot row is created.
	source.rules[0].RuleContent = "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n    for: 5m\n"
	deadURL, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	failSvc := service.NewCenterRulesService(repo, source, sink, outputDir, deadURL)
	failSvc.SetValidator(passed())
	snapshot, err := failSvc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "failed", snapshot.ValidationStatus)
	assert.Equal(t, "platform_fault", snapshot.ValidationCause)
	require.NotEmpty(t, sink.outcomes["rule-1"])

	current, err := repo.CurrentPassed(context.Background())
	require.NoError(t, err)
	require.NotNil(t, current)
	assert.Equal(t, first.ID, current.ID, "failed attempt keeps the previous current version")
	items, err := repo.List(context.Background(), 20)
	require.NoError(t, err)
	require.Len(t, items, 1, "failed attempts are not persisted as config snapshots")
}

func TestCenterRulesSyncBackfillsCurrentPayloadWithPersistedVersion(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}}
	outputDir := t.TempDir()
	svc := service.NewCenterRulesService(repo, source, nil, outputDir, nil)
	svc.SetValidator(passed())

	first, err := svc.Sync(context.Background())
	require.NoError(t, err)
	store := storage.NewContentStore(outputDir)
	require.NoError(t, store.Delete(repository.ArtifactTypeCenterKey, first.Version))

	again, err := svc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, first.ID, again.ID, "unchanged content keeps the current snapshot")

	payload, err := store.ReadPayload(repository.ArtifactTypeCenterKey, first.Version)
	require.NoError(t, err)
	assert.Equal(t, first.Version, payload.Version,
		"backfilled metadata must carry the persisted version, not the tentative one")
}

func TestCenterRulesSyncDoesNotPersistFailedAttempts(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}}
	deadURL, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	svc := service.NewCenterRulesService(repo, source, nil, t.TempDir(), deadURL)
	svc.SetValidator(passed())

	first, err := svc.Sync(context.Background())
	require.NoError(t, err)
	require.Equal(t, "failed", first.ValidationStatus)
	assert.Zero(t, first.ID, "failed attempts are returned in memory but not persisted")

	second, err := svc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "failed", second.ValidationStatus)
	assert.Zero(t, second.ID)

	items, err := repo.List(context.Background(), 20)
	require.NoError(t, err)
	require.Empty(t, items, "failed retries must not create history rows")
}

func TestCenterRulesSyncPassAfterFailureCreatesOnlySuccessSnapshot(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}}
	outputDir := t.TempDir()

	deadURL, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	failSvc := service.NewCenterRulesService(repo, source, nil, outputDir, deadURL)
	failSvc.SetValidator(passed())
	failedSnapshot, err := failSvc.Sync(context.Background())
	require.NoError(t, err)
	require.Equal(t, "failed", failedSnapshot.ValidationStatus)
	assert.Zero(t, failedSnapshot.ID)

	reloadServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/-/reload" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer reloadServer.Close()
	liveURL, err := url.Parse(reloadServer.URL)
	require.NoError(t, err)

	passSvc := service.NewCenterRulesService(repo, source, nil, outputDir, liveURL)
	passSvc.SetValidator(passed())
	passedSnapshot, err := passSvc.Sync(context.Background())
	require.NoError(t, err)
	assert.NotZero(t, passedSnapshot.ID)
	assert.NotEqual(t, failedSnapshot.Version, passedSnapshot.Version,
		"the successful retry is a new config version, not a failed row update")
	assert.Equal(t, "passed", passedSnapshot.ValidationStatus)
	assert.True(t, passedSnapshot.IsCurrent)

	items, err := repo.List(context.Background(), 20)
	require.NoError(t, err)
	require.Len(t, items, 1, "only the successful version is persisted")

	current, err := repo.CurrentPassed(context.Background())
	require.NoError(t, err)
	require.NotNil(t, current)
	assert.Equal(t, passedSnapshot.ID, current.ID)
}

func TestCenterRulesSyncCollapsesSameDayHistory(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{rules: []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}}
	svc := service.NewCenterRulesService(repo, source, nil, t.TempDir(), nil)
	svc.SetValidator(passed())

	for i := 0; i < 5; i++ {
		source.rules[0].RuleContent = "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n    for: " + itoa(int64(i+1)) + "m\n"
		_, err := svc.Sync(context.Background())
		require.NoError(t, err)
	}

	items, err := repo.List(context.Background(), 20)
	require.NoError(t, err)
	require.Len(t, items, 1, "same-day changes keep only the latest successful center version")
	assert.True(t, items[0].IsCurrent)
}

func TestCenterRulesSyncPassesEffectiveJobNames(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{
		rules: []references.CenterRule{{
			ID:          "rule-1",
			RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up{job=\"node\"} == 0\n",
		}},
		jobs: []string{"node"},
	}
	validator := &capturingValidator{
		result: configgen.ValidationResult{Status: "passed", Cause: "none", Details: "[]"},
	}
	svc := service.NewCenterRulesService(repo, source, nil, t.TempDir(), nil)
	svc.SetValidator(validator)

	_, err := svc.Sync(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{"node"}, validator.jobs,
		"center rule validation must receive the global effective job union")
}

func TestCenterRulesSyncConcurrentCallsShareOneSnapshot(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{
		rules: []references.CenterRule{{
			ID:          "rule-1",
			RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
		}},
		jobs: []string{"node"},
	}
	svc := service.NewCenterRulesService(repo, source, nil, t.TempDir(), nil)
	svc.SetValidator(passed())

	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := svc.Sync(context.Background())
			assert.NoError(t, err)
		}()
	}
	wg.Wait()

	items, err := repo.List(context.Background(), 20)
	require.NoError(t, err)
	assert.Len(t, items, 1, "concurrent watcher/trigger calls must not duplicate center history")
}

func TestCenterRulesWatcherRetriesPlatformFaultWithoutNewRows(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{
		rules: []references.CenterRule{{
			ID:          "rule-1",
			RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
		}},
		fp: time.Now(),
	}
	deadURL, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	svc := service.NewCenterRulesService(repo, source, nil, t.TempDir(), deadURL)
	svc.SetValidator(passed())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		svc.RunWatcher(ctx, 10*time.Millisecond)
		close(done)
	}()

	require.Eventually(t, func() bool { return source.Calls() >= 2 }, 2*time.Second, 5*time.Millisecond,
		"platform faults are retried on the next tick")

	items, err := repo.List(context.Background(), 20)
	require.NoError(t, err)
	require.Empty(t, items, "failed retries are not persisted as config snapshots")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("watcher did not stop after context cancellation")
	}
}

func TestCenterRulesWatcherDoesNotSpinOnZeroFingerprint(t *testing.T) {
	gormDB, _, _ := newTestStack(t)
	repo := repository.NewCenterSnapshotRepository(gormDB)
	source := &fakeCenterSource{} // zero fingerprint: no enabled rules
	svc := service.NewCenterRulesService(repo, source, nil, t.TempDir(), nil)
	svc.SetValidator(passed())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		svc.RunWatcher(ctx, 10*time.Millisecond)
		close(done)
	}()

	require.Eventually(t, func() bool { return source.Calls() >= 1 }, 2*time.Second, 5*time.Millisecond,
		"watcher runs the initial pass")
	require.Never(t, func() bool { return source.Calls() > 1 }, 100*time.Millisecond, 10*time.Millisecond,
		"zero fingerprint is a valid no-change state, not a changed-every-tick state")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("watcher did not stop after context cancellation")
	}
}
