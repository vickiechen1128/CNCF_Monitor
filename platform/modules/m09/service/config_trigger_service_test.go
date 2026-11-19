package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func newTriggerStack(t *testing.T) (*service.ConfigTriggerService, *service.ConfigSyncService, *repository.GORMCenterSnapshotRepository, *fakeSource, *fakeCenterSource) {
	t.Helper()
	gormDB, onboard, repo := newTestStack(t)
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	syncSvc := service.NewConfigSyncService(repo, sources, storage.NewContentStore(t.TempDir()), passed())
	centerRepo := repository.NewCenterSnapshotRepository(gormDB)
	centerSource := &fakeCenterSource{}
	centerSvc := service.NewCenterRulesService(centerRepo, centerSource, nil, t.TempDir(), nil)
	centerSvc.SetValidator(passed())
	return service.NewConfigTriggerService(syncSvc, centerSvc, onboard), syncSvc, centerRepo, sources, centerSource
}

func TestConfigTriggerDomainWaitSyncsOnlyRequestedDomain(t *testing.T) {
	trigger, syncSvc, _, _, _ := newTriggerStack(t)

	result, err := trigger.Trigger(context.Background(), admin(), service.TriggerRequest{
		Scope:            service.TriggerScopeDomain,
		NetworkDomainIDs: []string{"mc-a"},
		Wait:             true,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Completed)
	require.Len(t, result.Domains, 1)
	assert.Equal(t, "mc-a", result.Domains[0].NetworkDomainID)
	assert.Equal(t, "passed", result.Domains[0].ValidationStatus)

	mcA, err := syncSvc.ListSnapshots(context.Background(), "mc-a", 10)
	require.NoError(t, err)
	assert.Len(t, mcA, 1)
	mcB, err := syncSvc.ListSnapshots(context.Background(), "mc-b", 10)
	require.NoError(t, err)
	assert.Empty(t, mcB, "scope=domain must not fan out to other domains")
}

func TestConfigTriggerCenterWaitSyncsRules(t *testing.T) {
	trigger, _, centerRepo, _, centerSource := newTriggerStack(t)
	centerSource.rules = []references.CenterRule{{
		ID:          "rule-1",
		RuleContent: "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
	}}
	centerSource.jobs = []string{"node"}

	result, err := trigger.Trigger(context.Background(), admin(), service.TriggerRequest{
		Scope: service.TriggerScopeCenter,
		Wait:  true,
	})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.True(t, result.Completed)
	require.NotNil(t, result.Center)
	assert.Equal(t, "passed", result.Center.ValidationStatus)

	current, err := centerRepo.CurrentPassed(context.Background())
	require.NoError(t, err)
	require.NotNil(t, current)
}

func TestConfigTriggerRejectsInvalidScopeAndEmptyDomains(t *testing.T) {
	trigger, _, _, _, _ := newTriggerStack(t)

	_, err := trigger.Trigger(context.Background(), admin(), service.TriggerRequest{Scope: "bogus"})
	require.Error(t, err)
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))

	_, err = trigger.Trigger(context.Background(), admin(), service.TriggerRequest{Scope: service.TriggerScopeDomain})
	require.Error(t, err)
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))

	_, err = trigger.Trigger(context.Background(), admin(), service.TriggerRequest{
		Scope:            service.TriggerScopeCenter,
		NetworkDomainIDs: []string{"mc-a"},
	})
	require.Error(t, err)
	assert.Equal(t, apierror.BadRequest, apierror.KindOf(err))
}

func TestConfigTriggerEnforcesDomainAuthorization(t *testing.T) {
	trigger, _, _, _, _ := newTriggerStack(t)

	_, err := trigger.Trigger(context.Background(), service.Actor{TenantID: "tenant-a"}, service.TriggerRequest{
		Scope:            service.TriggerScopeDomain,
		NetworkDomainIDs: []string{"mc-b"},
	})
	require.Error(t, err)
	assert.Equal(t, apierror.NotFound, apierror.KindOf(err))

	_, err = trigger.Trigger(context.Background(), service.Actor{TenantID: "tenant-a"}, service.TriggerRequest{
		Scope: service.TriggerScopeCenter,
	})
	require.Error(t, err)
	assert.Equal(t, apierror.Forbidden, apierror.KindOf(err))
}

func TestConfigTriggerAsyncCoalescesRapidRequests(t *testing.T) {
	trigger, _, _, sources, _ := newTriggerStack(t)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		trigger.Run(ctx)
		close(done)
	}()

	for i := 0; i < 3; i++ {
		_, err := trigger.Trigger(context.Background(), admin(), service.TriggerRequest{
			Scope:            service.TriggerScopeDomain,
			NetworkDomainIDs: []string{"mc-a"},
		})
		require.NoError(t, err)
	}

	require.Eventually(t, func() bool { return sources.BuildCalls() >= 1 }, 2*time.Second, 10*time.Millisecond,
		"debounced worker runs the queued domain")
	require.Never(t, func() bool { return sources.BuildCalls() > 1 }, 300*time.Millisecond, 20*time.Millisecond,
		"rapid saves for the same domain are coalesced into one generation")

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("trigger worker did not stop after context cancellation")
	}
}

func TestConfigTriggerNotifyDomainsEnqueues(t *testing.T) {
	trigger, _, _, sources, _ := newTriggerStack(t)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		trigger.Run(ctx)
		close(done)
	}()

	trigger.NotifyDomains(context.Background(), []string{"mc-a"})
	require.Eventually(t, func() bool { return sources.BuildCalls() == 1 }, 2*time.Second, 10*time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("trigger worker did not stop")
	}
}

func TestConfigTriggerNotifyAllDomainsEnqueues(t *testing.T) {
	trigger, _, _, sources, _ := newTriggerStack(t)
	sources.domains = []string{"mc-a", "mc-b"}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		trigger.Run(ctx)
		close(done)
	}()

	trigger.NotifyAllDomains(context.Background())
	require.Eventually(t, func() bool { return sources.BuildCalls() == 2 }, 2*time.Second, 10*time.Millisecond)

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("trigger worker did not stop")
	}
}
