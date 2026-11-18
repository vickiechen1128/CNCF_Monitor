package service_test

import (
	"context"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

type fakeSource struct {
	src         configgen.Source
	fingerprint int64
	// domains overrides EdgeDomainIDs (defaults to the single src domain).
	domains []string
	// buildHook runs at the start of BuildSource (concurrency instrumentation).
	buildHook func(domainID string)
}

func (f *fakeSource) BuildSource(_ context.Context, domainID string) (configgen.Source, error) {
	if f.buildHook != nil {
		f.buildHook(domainID)
	}
	source := f.src
	source.NetworkDomainID = domainID
	return source, nil
}

func (f *fakeSource) Fingerprint(_ context.Context, _ string) (time.Time, error) {
	return time.Unix(f.fingerprint, 0), nil
}

func (f *fakeSource) EdgeDomainIDs(_ context.Context) ([]string, error) {
	if len(f.domains) > 0 {
		return f.domains, nil
	}
	return []string{f.src.NetworkDomainID}, nil
}

type fakeValidator struct {
	result configgen.ValidationResult
}

func (f fakeValidator) Validate(_ context.Context, _ *configgen.Artifacts) configgen.ValidationResult {
	return f.result
}

func passed() fakeValidator {
	return fakeValidator{result: configgen.ValidationResult{Status: "passed", Cause: "none", Details: "[]"}}
}

func failed(cause string) fakeValidator {
	return fakeValidator{result: configgen.ValidationResult{Status: "failed", Cause: cause, Details: `[{"message":"boom"}]`}}
}

func TestSyncDomainPublishesPassedSnapshot(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	svc := service.NewConfigSyncService(repo, sources, store, passed())

	snap, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, "passed", snap.ValidationStatus)
	assert.True(t, snap.IsCurrent)
	assert.Regexp(t, regexp.MustCompile(`^\d{8}-[0-9a-f]{4}$`), snap.Version)

	checksum, content, err := svc.CurrentContent(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, snap.Checksum, checksum)
	require.NotNil(t, content)
	assert.Contains(t, string(content), "network_domain_id: mc-a")
}

func TestSyncDomainFailureKeepsCurrent(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	passSvc := service.NewConfigSyncService(repo, sources, store, passed())
	first, err := passSvc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)

	// Source changes, but validation fails with a user-config cause.
	sources.src.Jobs[0].Targets = []configgen.Target{{Instance: "10.0.0.2:9100"}}
	failSvc := service.NewConfigSyncService(repo, sources, store, failed("user_config"))
	second, err := failSvc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, "failed", second.ValidationStatus)
	assert.Equal(t, "user_config", second.ValidationCause)
	assert.False(t, second.IsCurrent, "failed snapshot must not become current")

	checksum, _, err := failSvc.CurrentContent(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, first.Checksum, checksum, "current version is preserved on failure")
}

func TestSyncDomainSkipsUnchangedChecksum(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	svc := service.NewConfigSyncService(repo, sources, store, passed())

	first, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)
	second, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID, "unchanged source produces no new snapshot")

	items, err := svc.ListSnapshots(ctx, "mc-a", 50)
	require.NoError(t, err)
	assert.Len(t, items, 1)
}

func TestSyncDomainPrunesHistory(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{}}
	validator := passed()
	svc := service.NewConfigSyncService(repo, sources, store, validator)

	for i := 0; i < service.DefaultSnapshotRetention+3; i++ {
		sources.src.Jobs = []configgen.Job{{
			Name:    "node",
			Targets: []configgen.Target{{Instance: "10.0.0." + itoa(int64(i+1)) + ":9100"}},
		}}
		_, err := svc.SyncDomain(ctx, "mc-a")
		require.NoError(t, err)
	}

	items, err := svc.ListSnapshots(ctx, "mc-a", 50)
	require.NoError(t, err)
	assert.LessOrEqual(t, len(items), service.DefaultSnapshotRetention, "history is pruned to the retention window")
	require.NotEmpty(t, items)
	current := 0
	for _, item := range items {
		if item.IsCurrent {
			current++
		}
	}
	assert.Equal(t, 1, current, "exactly one current snapshot")
}

func TestSnapshotContentReadsStoredPayload(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	svc := service.NewConfigSyncService(repo, sources, store, passed())
	snap, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)

	metadata, raw, err := svc.SnapshotContent(ctx, "mc-a", snap.ID)
	require.NoError(t, err)
	require.NotNil(t, metadata)
	assert.Equal(t, snap.Checksum, metadata.Checksum)
	assert.NotEmpty(t, raw)

	missing, _, err := svc.SnapshotContent(ctx, "mc-a", 99999)
	require.NoError(t, err)
	assert.Nil(t, missing)
}

func TestRunWatcherInitialPassPublishesSnapshot(t *testing.T) {
	_, _, repo := newTestStack(t)
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{
		NetworkDomainID: "mc-a",
		Jobs: []configgen.Job{{
			Name:    "node",
			Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
		}},
	}}
	svc := service.NewConfigSyncService(repo, sources, store, passed())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		svc.RunWatcher(ctx, time.Hour) // first pass runs before the first tick
		close(done)
	}()

	require.Eventually(t, func() bool {
		items, err := svc.ListSnapshots(context.Background(), "mc-a", 10)
		return err == nil && len(items) == 1
	}, 2*time.Second, 10*time.Millisecond, "watcher publishes the initial snapshot")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("watcher did not stop after context cancellation")
	}
}

type recordingSink struct {
	calls       int
	domainID    string
	version     string
	generatedAt time.Time
	outcomes    map[string]string
}

func (r *recordingSink) RecordDomainSync(_ context.Context, domainID, version string, generatedAt time.Time, outcomes map[string]string) error {
	r.calls++
	r.domainID = domainID
	r.version = version
	r.generatedAt = generatedAt
	r.outcomes = outcomes
	return nil
}

func (r *recordingSink) RecordRuleSync(_ context.Context, _ string, _ time.Time, _ map[string]string) error {
	return nil
}

func TestSyncDomainWritesBackJobOutcomes(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	svc := service.NewConfigSyncService(repo, &fakeSource{src: configgen.Source{Jobs: []configgen.Job{
		{Name: "node", Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}}},
		{Name: "empty"},
	}}}, storage.NewContentStore(t.TempDir()), passed())
	sink := &recordingSink{}
	svc.SetSyncSink(sink)

	snap, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)
	require.Equal(t, 1, sink.calls)
	assert.Equal(t, "mc-a", sink.domainID)
	assert.Equal(t, snap.Version, sink.version)
	assert.Empty(t, sink.outcomes["node"])
	assert.Equal(t, "no resolvable targets", sink.outcomes["empty"])
}

func TestSyncDomainFailureWritesBackFailure(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	svc := service.NewConfigSyncService(repo, &fakeSource{src: configgen.Source{Jobs: []configgen.Job{
		{Name: "node", Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}}},
	}}}, storage.NewContentStore(t.TempDir()), failed("user_config"))
	sink := &recordingSink{}
	svc.SetSyncSink(sink)

	_, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)
	require.Equal(t, 1, sink.calls)
	assert.Contains(t, sink.outcomes["node"], "user_config")
}

func TestRunWatcherSyncsDomainsConcurrentlyWithBound(t *testing.T) {
	gormDB, _, repo := newTestStack(t)
	store := storage.NewContentStore(t.TempDir())
	domains := []string{"mc-a", "mc-b", "mc-c", "mc-d", "mc-e", "mc-f", "mc-g", "mc-h"}
	for _, id := range []string{"mc-c", "mc-d", "mc-e", "mc-f", "mc-g", "mc-h"} {
		createDomain(t, gormDB, id, models.DomainStatusEnabled)
	}

	started := make(chan string, len(domains))
	release := make(chan struct{})
	finished := make(chan string, len(domains))
	sources := &fakeSource{
		domains: domains,
		buildHook: func(domainID string) {
			started <- domainID
			<-release
			finished <- domainID
		},
	}
	svc := service.NewConfigSyncService(repo, sources, store, passed())

	runCtx, cancel := context.WithCancel(context.Background())
	defer cancel()
	watcherDone := make(chan struct{})
	go func() {
		svc.RunWatcher(runCtx, time.Hour)
		close(watcherDone)
	}()

	// 恰好 DefaultSyncWorkers 个域同时进入构建
	for i := 0; i < service.DefaultSyncWorkers; i++ {
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatalf("only %d/%d domains started concurrently", i, service.DefaultSyncWorkers)
		}
	}
	// 上限：第 workers+1 个不得进入
	select {
	case <-started:
		t.Fatalf("more than %d domains synced concurrently", service.DefaultSyncWorkers)
	case <-time.After(150 * time.Millisecond):
	}

	close(release)
	for i := 0; i < len(domains); i++ {
		select {
		case <-finished:
		case <-time.After(5 * time.Second):
			t.Fatalf("timed out after %d/%d domains finished", i, len(domains))
		}
	}
	cancel()
	<-watcherDone
}
