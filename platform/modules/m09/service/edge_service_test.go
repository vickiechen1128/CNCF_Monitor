package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func TestHeartbeatAutoRegistersAndUpdates(t *testing.T) {
	gormDB, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	edge := service.NewEdgeService(repo, repo)

	token, err := onboarding.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)
	require.NotEmpty(t, token.TokenPlain)

	resp, err := edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1",
		AgentType:       "vmagent",
		Version:         "v1.0.0",
		ConfigVersion:   "20261111-0a1b",
		Hostname:        "edge-node-01",
		IP:              "10.0.0.5",
		Components: []domain.Component{
			{Type: "agent", Name: "edge-sync-agent", Status: "running", Version: "v1.0.0"},
			{Type: "collector", Name: "vmagent", Status: "running", Version: "vmagent-1.101", RestartCount: 1},
		},
		QueueBacklogBytes: 1024,
	})
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged)
	assert.False(t, resp.ServerTime.IsZero())
	assert.Zero(t, resp.VMAgentRestartSeq)

	items, total, err := edge.ListAgents(ctx, admin(), repository.EdgeAgentFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, items, 1)
	agent := items[0]
	assert.Equal(t, "edge-node-01", agent.Hostname)
	assert.Equal(t, domain.EdgeAgentStatusOnline, agent.Status)
	assert.Equal(t, "vmagent", agent.AgentType)
	assert.Equal(t, "running", agent.CollectorStatus)
	assert.Equal(t, "vmagent-1.101", agent.CollectorVersion)
	require.Len(t, agent.Components, 2)
	assert.EqualValues(t, 1, agent.Components[1].RestartCount)
	assert.EqualValues(t, 1024, agent.QueueBacklogBytes)

	var history int64
	require.NoError(t, gormDB.Table("edge_heartbeats").Where("network_domain_id = ?", "mc-a").Count(&history).Error)
	assert.EqualValues(t, 1, history)

	// A second heartbeat updates the same agent instead of registering a new one.
	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1", Hostname: "edge-node-01", IP: "10.0.0.6",
	})
	require.NoError(t, err)
	_, total, err = edge.ListAgents(ctx, admin(), repository.EdgeAgentFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.EqualValues(t, 1, total, "same (domain, hostname) updates in place")
	require.NoError(t, gormDB.Table("edge_heartbeats").Where("network_domain_id = ?", "mc-a").Count(&history).Error)
	assert.EqualValues(t, 2, history, "each heartbeat appends history")
}

func TestHeartbeatTargetsReplaceAndKeep(t *testing.T) {
	gormDB, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	edge := service.NewEdgeService(repo, repo)
	_, err := onboarding.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	targets := func(jobs ...string) []domain.TargetSnapshot {
		out := make([]domain.TargetSnapshot, 0, len(jobs))
		for _, job := range jobs {
			out = append(out, domain.TargetSnapshot{
				Job: job, Instance: "10.0.0.1:9100", Health: "up",
				LastScrape: time.Now().UTC().Format(time.RFC3339),
			})
		}
		return out
	}

	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1", Hostname: "node-1",
		TargetsCollected: true, Targets: targets("node-exporter", "blackbox"),
	})
	require.NoError(t, err)
	countTargets := func() int64 {
		var n int64
		require.NoError(t, gormDB.Table("edge_target_snapshots").
			Where("network_domain_id = ?", "mc-a").Count(&n).Error)
		return n
	}
	assert.EqualValues(t, 2, countTargets())

	// A successful collection with fewer targets clears the stale ones.
	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1", Hostname: "node-1",
		TargetsCollected: true, Targets: targets("node-exporter"),
	})
	require.NoError(t, err)
	assert.EqualValues(t, 1, countTargets())

	// A failed collection (targets_collected=false) keeps the previous snapshot.
	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1", Hostname: "node-1", TargetsCollected: false,
	})
	require.NoError(t, err)
	assert.EqualValues(t, 1, countTargets())
}

func TestHeartbeatValidation(t *testing.T) {
	_, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	edge := service.NewEdgeService(repo, repo)
	_, err := onboarding.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{ProtocolVersion: "v2", Hostname: "node-1"})
	assert.Equal(t, "bad_request", string(kindOf(err)))

	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{ProtocolVersion: "v1"})
	assert.Equal(t, "bad_request", string(kindOf(err)), "hostname is required")

	_, err = edge.HandleHeartbeat(ctx, "mc-b", domain.HeartbeatRequest{ProtocolVersion: "v1", Hostname: "node-1"})
	assert.Equal(t, "conflict", string(kindOf(err)), "unmonitored domain is rejected")
}

func TestTokenValidator(t *testing.T) {
	_, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	validator := service.NewTokenValidator(repo)

	first, err := onboarding.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	id, ok := validator.Validate(ctx, first.TokenPlain)
	assert.True(t, ok)
	assert.Equal(t, "mc-a", id)

	_, ok = validator.Validate(ctx, "mctok_v1_deadbeef")
	assert.False(t, ok)

	reset, err := onboarding.ResetToken(ctx, admin(), "mc-a")
	require.NoError(t, err)
	_, ok = validator.Validate(ctx, first.TokenPlain)
	assert.False(t, ok, "reset revokes the old token")
	id, ok = validator.Validate(ctx, reset.TokenPlain)
	assert.True(t, ok)
	assert.Equal(t, "mc-a", id)

	require.NoError(t, onboarding.Unmonitor(ctx, admin(), "mc-a"))
	_, ok = validator.Validate(ctx, reset.TokenPlain)
	assert.False(t, ok, "unmonitor revokes the token")
}

func TestAgentCommandsOfflineAndCleanup(t *testing.T) {
	gormDB, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	edge := service.NewEdgeService(repo, repo)
	_, err := onboarding.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)
	_, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{ProtocolVersion: "v1", Hostname: "node-1"})
	require.NoError(t, err)

	items, _, err := edge.ListAgents(ctx, admin(), repository.EdgeAgentFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Len(t, items, 1)
	id := items[0].ID

	agent, err := edge.RestartAgent(ctx, admin(), id, "admin")
	require.NoError(t, err)
	assert.EqualValues(t, 1, agent.VMAgentRestartSeq)
	agent, err = edge.RestartAgent(ctx, admin(), id, "admin")
	require.NoError(t, err)
	assert.EqualValues(t, 2, agent.VMAgentRestartSeq)
	assert.Equal(t, "admin", agent.RestartRequestedBy)

	agent, err = edge.FlushBacklogAgent(ctx, admin(), id, "admin")
	require.NoError(t, err)
	assert.EqualValues(t, 1, agent.FlushBacklogSeq)

	// Age the heartbeat past the offline threshold.
	require.NoError(t, gormDB.Exec(`UPDATE edge_agents SET last_heartbeat_at = ? WHERE id = ?`,
		time.Now().UTC().Add(-10*time.Minute), id).Error)
	agent, err = edge.GetAgent(ctx, admin(), id)
	require.NoError(t, err)
	assert.Equal(t, domain.EdgeAgentStatusOffline, agent.Status, "effective status is derived from heartbeat age")

	_, err = edge.RestartAgent(ctx, admin(), id, "admin")
	assert.Equal(t, "bad_request", string(kindOf(err)), "offline node rejects commands")

	moved, err := edge.DetectOffline(ctx)
	require.NoError(t, err)
	assert.EqualValues(t, 1, moved)

	// Seed an expired heartbeat and verify retention cleanup.
	require.NoError(t, gormDB.Exec(`INSERT INTO edge_heartbeats
		(network_domain_id, hostname, timestamp) VALUES ('mc-a','node-1',?)`,
		time.Now().UTC().Add(-8*24*time.Hour)).Error)
	var before int64
	require.NoError(t, gormDB.Table("edge_heartbeats").Where("network_domain_id = ?", "mc-a").Count(&before).Error)
	deleted, err := edge.CleanupHeartbeats(ctx)
	require.NoError(t, err)
	assert.EqualValues(t, 1, deleted)
	var after int64
	require.NoError(t, gormDB.Table("edge_heartbeats").Where("network_domain_id = ?", "mc-a").Count(&after).Error)
	assert.EqualValues(t, before-1, after)
}

func TestHeartbeatReportsConfigChanged(t *testing.T) {
	_, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	_, err := onboarding.Monitor(ctx, admin(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	store := storage.NewContentStore(t.TempDir())
	sources := &fakeSource{src: configgen.Source{Jobs: []configgen.Job{{
		Name:    "node",
		Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
	}}}}
	cfgSvc := service.NewConfigSyncService(repo, sources, store, passed())
	snap, err := cfgSvc.SyncDomain(ctx, "mc-a")
	require.NoError(t, err)

	edge := service.NewEdgeService(repo, repo)
	resp, err := edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1", Hostname: "node-1",
	})
	require.NoError(t, err)
	assert.True(t, resp.ConfigChanged, "first heartbeat has no reported version")
	assert.Equal(t, snap.Version, resp.ConfigVersion)
	assert.Equal(t, snap.Checksum, resp.ConfigChecksum)
	assert.Contains(t, resp.ConfigDownloadURL, "/api/v3/edge/config?network_domain=mc-a")

	resp, err = edge.HandleHeartbeat(ctx, "mc-a", domain.HeartbeatRequest{
		ProtocolVersion: "v1", Hostname: "node-1", ConfigVersion: snap.Version,
	})
	require.NoError(t, err)
	assert.False(t, resp.ConfigChanged, "reported version matches the current snapshot")
}

func TestAgentScopeNonAdmin(t *testing.T) {
	_, onboarding, repo := newTestStack(t)
	ctx := context.Background()
	edge := service.NewEdgeService(repo, repo)
	_, err := onboarding.Monitor(ctx, admin(), "mc-b", service.Endpoint{})
	require.NoError(t, err)
	_, err = edge.HandleHeartbeat(ctx, "mc-b", domain.HeartbeatRequest{ProtocolVersion: "v1", Hostname: "node-b"})
	require.NoError(t, err)

	// tenant-a is only authorized for mc-a.
	items, total, err := edge.ListAgents(ctx, service.Actor{TenantID: "tenant-a"}, repository.EdgeAgentFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	assert.Zero(t, total)
	assert.Empty(t, items)

	adminItems, _, err := edge.ListAgents(ctx, admin(), repository.EdgeAgentFilter{Page: 1, PageSize: 10})
	require.NoError(t, err)
	require.Len(t, adminItems, 1)
	_, err = edge.GetAgent(ctx, service.Actor{TenantID: "tenant-a"}, adminItems[0].ID)
	assert.Equal(t, "not_found", string(kindOf(err)), "unauthorized agent detail is 404")
}
