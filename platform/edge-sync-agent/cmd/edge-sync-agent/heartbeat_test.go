package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/deployer"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/supervisor"
)

// badApplyZip 构造一个会被 Deployer.Apply 拒收的配置包（targets 文件为空数组 `[]`），
// 与 F-17 真实故障同形（边缘 ValidateTargetsJSON 报 empty array → 回滚且不落盘）。
func badApplyZip(t *testing.T, version string) []byte {
	t.Helper()
	return applyZip(t, version, `[]`)
}

// goodApplyZip 构造一个合法的配置包（targets 非空）。
func goodApplyZip(t *testing.T, version string) []byte {
	t.Helper()
	return applyZip(t, version, `[{"targets":["10.0.0.1:9100"],"labels":{"job":"app"}}]`)
}

func applyZip(t *testing.T, version, targetsJSON string) []byte {
	t.Helper()
	prom := "global:\n  scrape_interval: 30s\nscrape_configs:\n  - job_name: app\n    file_sd_configs:\n      - files:\n          - targets/app.json\n"
	meta, _ := json.Marshal(contract.Metadata{ConfigVersion: version, AgentType: "vmagent", Checksum: "x"})
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	add(contract.ZipEntryPrometheus, prom)
	add("targets/app.json", targetsJSON)
	add(contract.ZipEntryMetadata, string(meta))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestRuntimeProviderSnapshotCarriesApplyError 覆盖 D-1 验收 1 的心跳装配路径：
// runtimeProvider.Snapshot 从 deployer 读取最近一次应用失败状态。
func TestRuntimeProviderSnapshotCarriesApplyError(t *testing.T) {
	cfg := config.Defaults()
	cfg.Version = "v0.2.0"
	dep := deployer.New(t.TempDir(), "gov-cloud-a", logger.New(nil), nil, nil, nil)
	if err := dep.Apply(context.Background(), badApplyZip(t, "v9"), &contract.Metadata{ConfigVersion: "v9"}); err == nil {
		t.Fatal("empty targets package should fail to apply")
	}
	sv := supervisor.NewSupervisor(supervisor.DefaultParams(), &stubProbe{}, logger.New(nil))

	rt := &runtimeProvider{cfg: cfg, deployer: dep, sv: sv, hostname: "node-9", ip: "10.0.0.9"}
	snap := rt.Snapshot()
	if snap.ConfigApplyError == "" || snap.ConfigApplyFailedVersion != "v9" {
		t.Fatalf("apply state not carried into snapshot: %+v", snap)
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

func (stubProbe) Ready(*supervisor.Component) bool { return true }
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

// TestRuntimeProviderSnapshotCarriesRemoteWriteStats 覆盖 F-39 心跳装配路径：
// runtimeProvider.Snapshot 从本机 vmagent /metrics 解析持久队列积压与丢块/重试计数，
// QueueBacklogBytes 取 max(内存缓冲, 磁盘持久队列)，丢块/重试随快照透传给心跳。
func TestRuntimeProviderSnapshotCarriesRemoteWriteStats(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(metricsPersistentQueueBacklog))
	}))
	defer srv.Close()

	stub := &stubProbe{}
	sv := supervisor.NewSupervisor(supervisor.DefaultParams(), stub, logger.New(nil))
	cfg := config.Defaults()
	cfg.Version = "v0.2.0"

	rt := &runtimeProvider{cfg: cfg, sv: sv, hostname: "node-f39", ip: "10.0.0.39", targetBaseURL: srv.URL}
	snap := rt.Snapshot()
	// 持久队列 555000000 > 内存缓冲 1024 → 积压读数取持久队列（F-39 核心修正）。
	if snap.QueueBacklogBytes != 555000000 {
		t.Fatalf("queue_backlog = %d want 555000000", snap.QueueBacklogBytes)
	}
	if snap.RemoteWriteDroppedTotal != 9 {
		t.Fatalf("dropped_total = %d want 9", snap.RemoteWriteDroppedTotal)
	}
	if snap.RemoteWriteRetriesTotal != 20 {
		t.Fatalf("retries_total = %d want 20", snap.RemoteWriteRetriesTotal)
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
