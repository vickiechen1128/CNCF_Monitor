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

func TestBuildHeartbeatRequestMapping(t *testing.T) {
	cfg := config.Defaults()
	cfg.NetworkDomainID = "gov-cloud-a"
	cfg.AgentType = "vmagent"
	cfg.Version = "v0.2.0"
	cfg.RWQueueMaxShards = 50

	comps := []contract.Component{
		{Type: contract.ComponentTypeCollector, Status: contract.ComponentStatusRunning, RestartCount: 3},
	}
	hb := buildHeartbeatRequest(cfg, "20260918-120000", 12345, cfg.RWQueueMaxShards, "node-1", "10.1.1.5", comps, nil)

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

// TestHeartbeatRequestCarriesApplyError 覆盖 D-1 验收 1：Apply 失败 → 心跳携带
// config_apply_error + 失败版本；后续成功应用 → 字段清空且 JSON 不产出该键（omitempty）。
func TestHeartbeatRequestCarriesApplyError(t *testing.T) {
	cfg := config.Defaults()
	cfg.NetworkDomainID = "gov-cloud-a"
	cfg.AgentType = "vmagent"
	cfg.Version = "v0.2.0"

	dep := deployer.New(t.TempDir(), "gov-cloud-a", logger.New(nil), nil, nil, nil)
	ctx := context.Background()

	// 旧版本先应用成功（模拟现场：节点已生效 v1）。
	if err := dep.Apply(ctx, goodApplyZip(t, "v1"), &contract.Metadata{ConfigVersion: "v1"}); err != nil {
		t.Fatalf("apply v1: %v", err)
	}
	hb0 := buildHeartbeatRequest(cfg, dep.CurrentVersion(), 0, 0, "node-1", "10.0.0.1", nil, dep)
	if hb0.ConfigApplyError != "" || hb0.ConfigApplyFailedVersion != "" {
		t.Fatalf("no failure expected: %+v", hb0)
	}

	// v2 应用失败（空 targets 被拒收）→ 心跳上送失败原因与失败版本。
	if err := dep.Apply(ctx, badApplyZip(t, "v2"), &contract.Metadata{ConfigVersion: "v2"}); err == nil {
		t.Fatal("empty targets package should fail to apply")
	}
	hb := buildHeartbeatRequest(cfg, dep.CurrentVersion(), 0, 0, "node-1", "10.0.0.1", nil, dep)
	if hb.ConfigApplyError == "" {
		t.Fatalf("config_apply_error not carried: %+v", hb)
	}
	if !strings.Contains(hb.ConfigApplyError, "empty array") {
		t.Fatalf("config_apply_error = %q", hb.ConfigApplyError)
	}
	if hb.ConfigApplyFailedVersion != "v2" {
		t.Fatalf("config_apply_failed_version = %q", hb.ConfigApplyFailedVersion)
	}
	// 失败版本仍以旧生效版本（v1）上报，中心据此判「已拉到最新但应用失败」。
	if hb.ConfigVersion != "v1" {
		t.Fatalf("config_version = %q", hb.ConfigVersion)
	}

	// 后续成功应用 v3 → 错误字段清空且 JSON 无这两键。
	if err := dep.Apply(ctx, goodApplyZip(t, "v3"), &contract.Metadata{ConfigVersion: "v3"}); err != nil {
		t.Fatalf("apply v3: %v", err)
	}
	hb2 := buildHeartbeatRequest(cfg, dep.CurrentVersion(), 0, 0, "node-1", "10.0.0.1", nil, dep)
	if hb2.ConfigApplyError != "" || hb2.ConfigApplyFailedVersion != "" {
		t.Fatalf("apply error not cleared after success: %+v", hb2)
	}
	b, err := json.Marshal(hb2)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "config_apply_error") || strings.Contains(string(b), "config_apply_failed_version") {
		t.Fatalf("omitempty keys should be absent: %s", b)
	}
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
