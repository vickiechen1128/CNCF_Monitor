package main

import (
	"strings"
	"testing"

	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/supervisor"
)

func TestBuildHeartbeatRequestMapping(t *testing.T) {
	cfg := config.Defaults()
	cfg.NetworkDomainID = "gov-cloud-a"
	cfg.AgentType = "vmagent"
	cfg.Version = "v0.2.0"
	cfg.RWQueueMaxShards = 50

	comps := []contract.Component{
		{Type: contract.ComponentTypeCollector, Status: contract.ComponentStatusRunning, RestartCount: 3},
	}
	hb := buildHeartbeatRequest(cfg, "20260918-120000", 12345, cfg.RWQueueMaxShards, "node-1", "10.1.1.5", comps)

	if hb.NetworkDomainID != "gov-cloud-a" || hb.AgentType != "vmagent" || hb.Version != "v0.2.0" {
		t.Fatalf("identity fields wrong: %+v", hb)
	}
	if hb.ConfigVersion != "20260918-120000" {
		t.Fatalf("config_version = %s", hb.ConfigVersion)
	}
	if hb.WalBacklogBytes != 12345 {
		t.Fatalf("wal_backlog = %d", hb.WalBacklogBytes)
	}
	if hb.RemoteWriteQueueSize != 50 {
		t.Fatalf("remote_write_queue_size = %d", hb.RemoteWriteQueueSize)
	}
	if hb.Hostname != "node-1" || hb.Ip != "10.1.1.5" {
		t.Fatalf("host identity wrong: %+v", hb)
	}
	if len(hb.Components) != 1 || hb.Components[0].Type != contract.ComponentTypeCollector {
		t.Fatalf("components wrong: %+v", hb.Components)
	}
}

func TestRuntimeProviderSnapshot(t *testing.T) {
	stub := &stubProbe{}
	sv := supervisor.NewSupervisor(supervisor.DefaultParams(), stub, logger.New(nil))
	cfg := config.Defaults()
	cfg.Version = "v0.2.0"
	cfg.RWQueueMaxShards = 50

	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeCollector, Name: "collector", Version: "v0.2.0", ConfigVersion: "v9"}})

	rt := &runtimeProvider{cfg: cfg, sv: sv, hostname: "node-2", ip: "10.0.0.9"}
	snap := rt.Snapshot()
	if snap.AgentVersion != "v0.2.0" {
		t.Fatalf("agent version = %s", snap.AgentVersion)
	}
	if len(snap.Components) != 1 || snap.Components[0].Status != contract.ComponentStatusNotDeployed {
		t.Fatalf("components = %+v", snap.Components)
	}
	if snap.RemoteWriteQueueSize != 50 {
		t.Fatalf("rw queue = %d", snap.RemoteWriteQueueSize)
	}
	if snap.Hostname != "node-2" {
		t.Fatalf("hostname = %s", snap.Hostname)
	}
}

// stubProbe 供 supervisor 构造（Snapshot 不需要探针真实启停）。
type stubProbe struct{}

func (stubProbe) Alive(*supervisor.Component) bool { return false }
func (stubProbe) Healthy(*supervisor.Component) bool {
	return false
}
func (stubProbe) Start(*supervisor.Component) error { return nil }
func (stubProbe) Stop(*supervisor.Component) error  { return nil }

func TestEnvOr(t *testing.T) {
	if envOr("__NONEXISTENT_ENV_123__", "def") != "def" {
		t.Fatal("envOr should return default when var missing")
	}
	// 注入一个空串覆盖场景。
	t.Setenv("__EMPTY_ENV_123__", "")
	if envOr("__EMPTY_ENV_123__", "d2") != "d2" {
		t.Fatal("envOr should treat empty as default")
	}
}

func TestVersionFlagString(t *testing.T) {
	if !strings.Contains(version, "v0.2") {
		t.Fatalf("version = %q", version)
	}
}
