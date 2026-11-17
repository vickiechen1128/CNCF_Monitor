package service

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/modules/m08/apply"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// newTestDB opens a migrated v3 SQLite database for the M08 tests.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m08-test.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	g, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	return g
}

type stubChecker struct{ err error }

func (s *stubChecker) Check(context.Context, string) error { return s.err }

type stubReloader struct {
	reloadErr error
	verifyErr error
	calls     int
}

func (s *stubReloader) Reload(context.Context) error {
	s.calls++
	return s.reloadErr
}

func (s *stubReloader) Verify(context.Context) error { return s.verifyErr }

type stubSink struct {
	calls   int
	content string
}

func (s *stubSink) SaveAlertmanagerSnapshot(_ context.Context, _ string, content, _ string, _ string) error {
	s.calls++
	s.content = content
	return nil
}

type stubDomainReader struct{ usable bool }

func (s stubDomainReader) Status(context.Context, string) (string, bool, error) {
	return "enabled", s.usable, nil
}

func (s stubDomainReader) Usable(context.Context, string) (bool, error) { return s.usable, nil }

func newConfigService(t *testing.T, checker ConfigChecker) (*ConfigService, *stubReloader, *stubSink, *gorm.DB) {
	t.Helper()
	g := newTestDB(t)
	snapshots := repository.NewSnapshotRepository(g)
	channels := repository.NewChannelRepository(g)
	rules := repository.NewInhibitionRepository(g)
	templates := repository.NewTemplateRepository(g)
	reloadLogs := repository.NewReloadLogRepository(g)
	reloader := &stubReloader{}
	sinkImpl := &stubSink{}
	applier := apply.New(t.TempDir(), reloader, reloadLogs)
	svc := NewConfigService(snapshots, channels, rules, ConfigOptions{
		Checker: checker, Applier: applier, Sink: sinkImpl, SinkDomainID: "mc-a",
		DomainReader: stubDomainReader{usable: true}, BridgeBaseURL: "http://127.0.0.1:8080",
		ReloadLogs: reloadLogs,
	})
	svc.SetClock(func() time.Time { return time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC) })
	require.NoError(t, Seed(context.Background(), snapshots, templates, rules, svc, SeedOptions{}))
	return svc, reloader, sinkImpl, g
}

func TestSeedCreatesCurrentSnapshot(t *testing.T) {
	svc, _, _, _ := newConfigService(t, &stubChecker{})
	snapshot, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.True(t, snapshot.IsCurrent)
	assert.NotEmpty(t, snapshot.Checksum)
	require.Len(t, snapshot.RouteTree, 1)
	assert.Equal(t, "root", snapshot.RouteTree[0].ID)
}

func TestSaveRoutesAppliesAndPersists(t *testing.T) {
	svc, reloader, sink, _ := newConfigService(t, &stubChecker{})
	current, err := svc.Current(context.Background())
	require.NoError(t, err)

	tree := []domain.RouteNode{{
		ID: "root", Name: "根路由", Receiver: "default", Enabled: true,
		Children: []domain.RouteNode{{ID: "child", Receiver: "default", Enabled: true}},
	}}
	outcome, err := svc.SaveRoutes(context.Background(), current.Checksum, tree, "tester")
	require.NoError(t, err)
	assert.Equal(t, 1, reloader.calls)
	assert.Contains(t, outcome.PendingSections, string(domain.PendingRouteChanged))
	assert.True(t, outcome.SnapshotSynced)
	assert.Equal(t, 1, sink.calls)

	updated, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.NotEqual(t, current.Checksum, updated.Checksum)
	assert.Len(t, updated.RouteTree[0].Children, 1)
	assert.Equal(t, "tester", updated.GeneratedBy)
}

func TestSaveRoutesRejectsStaleChecksum(t *testing.T) {
	svc, _, _, _ := newConfigService(t, &stubChecker{})
	_, err := svc.SaveRoutes(context.Background(), "stale-checksum", []domain.RouteNode{{
		ID: "root", Receiver: "default", Enabled: true,
	}}, "tester")
	var conflict *domain.ConflictError
	assert.ErrorAs(t, err, &conflict)
}

func TestSaveRoutesValidationFailureKeepsCurrent(t *testing.T) {
	checker := &stubChecker{err: &domain.ConfigValidationError{
		Cause: domain.ValidationCauseUserConfig, Items: []domain.ValidationIssue{{Line: 3, Message: "bad"}},
	}}
	svc, reloader, _, _ := newConfigService(t, checker)
	current, err := svc.Current(context.Background())
	require.NoError(t, err)
	_, err = svc.SaveRoutes(context.Background(), current.Checksum, []domain.RouteNode{{
		ID: "root", Receiver: "default", Enabled: true,
	}}, "tester")
	var validation *domain.ConfigValidationError
	assert.ErrorAs(t, err, &validation)
	assert.Equal(t, 0, reloader.calls, "invalid config must never reach Alertmanager")

	still, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.Equal(t, current.Checksum, still.Checksum, "current snapshot must not move")
}

func TestSaveRoutesSkipsSinkWhenDomainUnusable(t *testing.T) {
	g := newTestDB(t)
	snapshots := repository.NewSnapshotRepository(g)
	channels := repository.NewChannelRepository(g)
	rules := repository.NewInhibitionRepository(g)
	templates := repository.NewTemplateRepository(g)
	reloadLogs := repository.NewReloadLogRepository(g)
	applier := apply.New(t.TempDir(), &stubReloader{}, reloadLogs)
	sink := &stubSink{}
	svc := NewConfigService(snapshots, channels, rules, ConfigOptions{
		Checker: &stubChecker{}, Applier: applier, Sink: sink, SinkDomainID: "missing",
		DomainReader: stubDomainReader{usable: false}, BridgeBaseURL: "http://127.0.0.1:8080",
		ReloadLogs: reloadLogs,
	})
	require.NoError(t, Seed(context.Background(), snapshots, templates, rules, svc, SeedOptions{}))
	current, err := svc.Current(context.Background())
	require.NoError(t, err)
	outcome, err := svc.SaveRoutes(context.Background(), current.Checksum, []domain.RouteNode{{
		ID: "root", Receiver: "default", Enabled: true,
	}}, "tester")
	require.NoError(t, err)
	assert.False(t, outcome.SnapshotSynced)
	assert.Equal(t, 0, sink.calls)
}

func TestReloadCurrentDoesNotCreateVersion(t *testing.T) {
	svc, reloader, _, _ := newConfigService(t, &stubChecker{})
	before, err := svc.Current(context.Background())
	require.NoError(t, err)
	_, err = svc.ReloadCurrent(context.Background(), "tester")
	require.NoError(t, err)
	assert.Equal(t, 1, reloader.calls)
	after, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.Equal(t, before.ID, after.ID)
}
