package service_test

import (
	"context"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func itoa(v int64) string { return strconv.FormatInt(v, 10) }

type fakeSource struct {
	src         configgen.Source
	fingerprint int64
}

func (f *fakeSource) BuildSource(_ context.Context, domainID string) (configgen.Source, error) {
	source := f.src
	source.NetworkDomainID = domainID
	return source, nil
}

func (f *fakeSource) Fingerprint(_ context.Context, _ string) (time.Time, error) {
	return time.Unix(f.fingerprint, 0), nil
}

func (f *fakeSource) EdgeDomainIDs(_ context.Context) ([]string, error) {
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

func TestSaveAlertmanagerSnapshotKeepsCurrentUntouched(t *testing.T) {
	_, _, repo := newTestStack(t)
	ctx := context.Background()
	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	svc := service.NewConfigSyncService(repo, sources, store, passed())
	current, err := svc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)

	require.NoError(t, svc.SaveAlertmanagerSnapshot(ctx, "mc-a", "route:\n  receiver: default\n", "sha256:am", "m08"))
	checksum, _, err := svc.CurrentContent(ctx, "mc-a")
	require.NoError(t, err)
	assert.Equal(t, current.Checksum, checksum, "M08 snapshot must not replace the scrape config")

	items, err := svc.ListSnapshots(ctx, "mc-a", 50)
	require.NoError(t, err)
	require.Len(t, items, 2)
	found := false
	for _, item := range items {
		if item.GeneratedBy == "m08" {
			found = true
			assert.False(t, item.IsCurrent)
			assert.Regexp(t, regexp.MustCompile(`^am-\d{8}-[0-9a-f]{4}$`), item.Version)
		}
	}
	assert.True(t, found)

	assert.Error(t, svc.SaveAlertmanagerSnapshot(ctx, "mc-a", "  ", "x", "m08"), "empty content is rejected")
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
