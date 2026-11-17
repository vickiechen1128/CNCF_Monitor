package apply

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

type fakeReloader struct {
	reloadErrs []error
	verifyErr  error
	reloads    int
}

func (f *fakeReloader) Reload(context.Context) error {
	f.reloads++
	if len(f.reloadErrs) == 0 {
		return nil
	}
	err := f.reloadErrs[0]
	f.reloadErrs = f.reloadErrs[1:]
	return err
}

func (f *fakeReloader) Verify(context.Context) error { return f.verifyErr }

type fakeLogs struct{ entries []*domain.ReloadLog }

func (f *fakeLogs) Insert(_ context.Context, entry *domain.ReloadLog) error {
	f.entries = append(f.entries, entry)
	return nil
}

func (f *fakeLogs) List(context.Context, repository.ReloadLogFilter) ([]*domain.ReloadLog, int64, error) {
	return f.entries, int64(len(f.entries)), nil
}

func TestApplySucceedsAndWritesAtomically(t *testing.T) {
	dir := t.TempDir()
	reloader := &fakeReloader{}
	logs := &fakeLogs{}
	applier := New(dir, reloader, logs)

	result, err := applier.Apply(context.Background(), Request{
		ConfigVersion: "20261116-0001", Checksum: "sum", Content: "route: {}\n",
		Trigger: domain.ReloadTriggerRouteSave, Operator: "tester",
	})
	require.NoError(t, err)
	assert.Equal(t, domain.ReloadStatusSucceeded, result.Status)
	assert.True(t, result.Written)
	raw, readErr := os.ReadFile(filepath.Join(dir, "alertmanager.yml"))
	require.NoError(t, readErr)
	assert.Equal(t, "route: {}\n", string(raw))
	require.Len(t, logs.entries, 1)
	assert.Equal(t, domain.ReloadStatusSucceeded, logs.entries[0].Status)
}

func TestApplySkipsWriteWhenUnchangedButStillReloads(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "alertmanager.yml"), []byte("same\n"), 0o600))
	reloader := &fakeReloader{}
	applier := New(dir, reloader, &fakeLogs{})

	result, err := applier.Apply(context.Background(), Request{Content: "same\n", Trigger: domain.ReloadTriggerManual})
	require.NoError(t, err)
	assert.False(t, result.Written)
	assert.Equal(t, 1, reloader.reloads, "manual reload must still hit Alertmanager")
}

func TestApplyRollsBackOnReloadFailure(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "alertmanager.yml"), []byte("previous: true\n"), 0o600))
	// First reload fails, rollback reload succeeds.
	reloader := &fakeReloader{reloadErrs: []error{errors.New("boom")}}
	logs := &fakeLogs{}
	applier := New(dir, reloader, logs)

	result, err := applier.Apply(context.Background(), Request{
		Content: "next: true\n", PreviousContent: "previous: true\n", Trigger: domain.ReloadTriggerRouteSave,
	})
	require.Error(t, err)
	assert.Equal(t, domain.ReloadStatusRolledBack, result.Status)
	var upstream *domain.UpstreamError
	assert.ErrorAs(t, err, &upstream)

	raw, readErr := os.ReadFile(filepath.Join(dir, "alertmanager.yml"))
	require.NoError(t, readErr)
	assert.Equal(t, "previous: true\n", string(raw), "previous content must be restored")
	require.Len(t, logs.entries, 1)
	assert.Equal(t, domain.ReloadStatusRolledBack, logs.entries[0].Status)
}

func TestApplyUnconfiguredTargetIsRetryable(t *testing.T) {
	applier := New("", nil, &fakeLogs{})
	_, err := applier.Apply(context.Background(), Request{Content: "x", Trigger: domain.ReloadTriggerRouteSave})
	var unavailable *domain.UnavailableError
	assert.ErrorAs(t, err, &unavailable)
}

func TestApplyVerifyFailureTriggersRollback(t *testing.T) {
	dir := t.TempDir()
	reloader := &fakeReloader{verifyErr: errors.New("unhealthy")}
	applier := New(dir, reloader, &fakeLogs{})
	result, err := applier.Apply(context.Background(), Request{
		Content: "new: true\n", PreviousContent: "old: true\n", Trigger: domain.ReloadTriggerRouteSave,
	})
	require.Error(t, err)
	assert.Equal(t, domain.ReloadStatusRolledBack, result.Status)
}

func TestApplyRecordsDurationAndFinishedAt(t *testing.T) {
	dir := t.TempDir()
	logs := &fakeLogs{}
	applier := New(dir, &fakeReloader{}, logs)
	fixed := time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC)
	applier.SetClock(func() time.Time { return fixed })
	_, err := applier.Apply(context.Background(), Request{Content: "x: 1\n", Trigger: domain.ReloadTriggerRouteSave})
	require.NoError(t, err)
	require.Len(t, logs.entries, 1)
	assert.NotNil(t, logs.entries[0].FinishedAt)
	assert.Equal(t, fixed, logs.entries[0].StartedAt)
}
