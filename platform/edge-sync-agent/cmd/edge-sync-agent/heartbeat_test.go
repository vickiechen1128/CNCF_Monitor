package main

import (
	"net/http"
	"net/http/httptest"
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
	if hb.QueueBacklogBytes != 12345 {
		t.Fatalf("queue_backlog = %d", hb.QueueBacklogBytes)
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

// TestRuntimeProviderSnapshotCarriesTargets 校验 runtimeProvider.Snapshot 从本机
// vmagent targets 接口抓取快照并填充 Targets（方案 B），且健康组件字段仍保留。
func TestRuntimeProviderSnapshotCarriesTargets(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(sampleTargetsResp))
	}))
	defer srv.Close()

	stub := &stubProbe{}
	sv := supervisor.NewSupervisor(supervisor.DefaultParams(), stub, logger.New(nil))
	cfg := config.Defaults()
	cfg.Version = "v0.2.0"
	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeCollector, Name: "collector", Version: "v0.2.0", ConfigVersion: "v9"}})

	rt := &runtimeProvider{cfg: cfg, sv: sv, hostname: "node-2", ip: "10.0.0.9", targetBaseURL: srv.URL}
	snap := rt.Snapshot()
	if len(snap.Targets) != 2 {
		t.Fatalf("targets not fetched: %+v", snap.Targets)
	}
	if snap.Targets[0].Job != "node" || snap.Targets[0].Health != "up" {
		t.Fatalf("targets[0] = %+v", snap.Targets[0])
	}
	// 组件字段不应被 targets 采集影响。
	if len(snap.Components) != 1 {
		t.Fatalf("components = %+v", snap.Components)
	}
}

// TestRuntimeProviderSnapshotTargetsDegrade 采集失败（本机 vmagent 接口不可达）时，
// Targets 降级为空且健康组件字段仍保留（采集失败不阻断心跳）。
func TestRuntimeProviderSnapshotTargetsDegrade(t *testing.T) {
	stub := &stubProbe{}
	sv := supervisor.NewSupervisor(supervisor.DefaultParams(), stub, logger.New(nil))
	cfg := config.Defaults()
	cfg.Version = "v0.2.0"
	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeCollector, Name: "collector", Status: contract.ComponentStatusRunning}})

	// 指向一个已关闭的 server → 连接失败 → Targets 空。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := srv.URL
	srv.Close()
	rt := &runtimeProvider{cfg: cfg, sv: sv, hostname: "node-3", ip: "10.0.0.10", targetBaseURL: closedURL}
	snap := rt.Snapshot()
	if len(snap.Targets) != 0 {
		t.Fatalf("targets should degrade to empty on failure, got %+v", snap.Targets)
	}
	if len(snap.Components) != 1 {
		t.Fatalf("components should remain: %+v", snap.Components)
	}
}

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
