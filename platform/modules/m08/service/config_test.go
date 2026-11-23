package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/apply"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

// newTestDB opens a migrated v3 PostgreSQL database for the M08 tests.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	g := testdb.Open(t)
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

func newConfigService(t *testing.T, checker ConfigChecker) (*ConfigService, *stubReloader, *gorm.DB) {
	t.Helper()
	g := newTestDB(t)
	snapshots := repository.NewSnapshotRepository(g)
	channels := repository.NewChannelRepository(g)
	rules := repository.NewInhibitionRepository(g)
	templates := repository.NewTemplateRepository(g)
	reloadLogs := repository.NewReloadLogRepository(g)
	reloader := &stubReloader{}
	applier := apply.New(t.TempDir(), reloader, reloadLogs)
	svc := NewConfigService(snapshots, channels, rules, ConfigOptions{
		Checker: checker, Applier: applier, BridgeBaseURL: "http://127.0.0.1:8080",
		ReloadLogs: reloadLogs,
	})
	svc.SetClock(func() time.Time { return time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC) })
	require.NoError(t, Seed(context.Background(), snapshots, templates, rules, svc, SeedOptions{}))
	return svc, reloader, g
}

func TestSeedCreatesCurrentSnapshot(t *testing.T) {
	svc, _, _ := newConfigService(t, &stubChecker{})
	snapshot, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.True(t, snapshot.IsCurrent)
	assert.NotEmpty(t, snapshot.Checksum)
	require.Len(t, snapshot.RouteTree, 1)
	assert.Equal(t, "root", snapshot.RouteTree[0].ID)
}

func TestSaveRoutesAppliesAndPersists(t *testing.T) {
	svc, reloader, _ := newConfigService(t, &stubChecker{})
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

	updated, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.NotEqual(t, current.Checksum, updated.Checksum)
	assert.Len(t, updated.RouteTree[0].Children, 1)
	assert.Equal(t, "tester", updated.GeneratedBy)
}

func TestSaveRoutesRejectsStaleChecksum(t *testing.T) {
	svc, _, _ := newConfigService(t, &stubChecker{})
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
	svc, reloader, _ := newConfigService(t, checker)
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

func TestReloadCurrentDoesNotCreateVersion(t *testing.T) {
	svc, reloader, _ := newConfigService(t, &stubChecker{})
	before, err := svc.Current(context.Background())
	require.NoError(t, err)
	_, err = svc.ReloadCurrent(context.Background(), "tester")
	require.NoError(t, err)
	assert.Equal(t, 1, reloader.calls)
	after, err := svc.Current(context.Background())
	require.NoError(t, err)
	assert.Equal(t, before.ID, after.ID)
}
