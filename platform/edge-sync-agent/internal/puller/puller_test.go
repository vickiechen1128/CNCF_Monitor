package puller

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/metriccenter/platform/edge-sync-agent/internal/client"
	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/token"
)

// buildZip 构造含指定内容的 config zip，并回填 metadata.checksum（联合重算）。
func buildZip(t *testing.T, promYML string, metaChecksum string) []byte {
	t.Helper()
	content := map[string]string{
		contract.ZipEntryPrometheus: promYML,
		"targets/app.json":          `[{"targets":["10.0.0.1:9100"]}]`,
	}
	if metaChecksum == "" {
		metaChecksum = recomputeChecksum(content)
	}
	meta := contract.Metadata{
		ConfigVersion: "20260918-120000",
		GeneratedAt:   "2026-09-18T12:00:00Z",
		AgentType:     "vmagent",
		Checksum:      metaChecksum,
	}
	metaJSON, _ := json.Marshal(meta)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	mustAdd := func(name, data string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	mustAdd(contract.ZipEntryPrometheus, promYML)
	mustAdd("targets/app.json", content["targets/app.json"])
	mustAdd(contract.ZipEntryMetadata, string(metaJSON))
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

type fakeDeploy struct {
	mu      sync.Mutex
	applied [][]byte
	metas   []*contract.Metadata
	err     error
}

func (f *fakeDeploy) Apply(_ context.Context, zipBytes []byte, meta *contract.Metadata) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.applied = append(f.applied, zipBytes)
	f.metas = append(f.metas, meta)
	return f.err
}
func (f *fakeDeploy) count() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.applied) }

type fakeRuntime struct{ snap RuntimeSnapshot }

func (f fakeRuntime) Snapshot() RuntimeSnapshot { return f.snap }

// TestBuildHeartbeatCarriesTargets 校验 buildHeartbeat 把 RuntimeSnapshot.Targets
// 透传给心跳契约（方案 B：边缘 vmagent 本地 target 快照随心跳上报）。
func TestBuildHeartbeatCarriesTargets(t *testing.T) {
	cfg := testConfig("http://center:8080")
	targets := []contract.EdgeTargetSnapshot{
		{Job: "node", Instance: "10.0.0.1:9100", Health: "up", ScrapeDurationSeconds: 0.01},
		{Job: "node", Instance: "10.0.0.2:9100", Health: "down", LastError: "refused"},
	}
	rt := fakeRuntime{snap: RuntimeSnapshot{
		AgentVersion:  "v0.2.0",
		ConfigVersion: "v9",
		Components:    []contract.Component{{Type: contract.ComponentTypeCollector, Status: contract.ComponentStatusRunning}},
		Targets:       targets,
	}}
	p := newPuller(cfg, nil, nil, rt)
	hb := p.buildHeartbeat()
	if len(hb.Targets) != 2 {
		t.Fatalf("targets not carried: %+v", hb.Targets)
	}
	if hb.Targets[0].Job != "node" || hb.Targets[0].Health != "up" || hb.Targets[0].ScrapeDurationSeconds != 0.01 {
		t.Fatalf("targets[0] = %+v", hb.Targets[0])
	}
	if hb.Targets[1].Health != "down" || hb.Targets[1].LastError != "refused" {
		t.Fatalf("targets[1] = %+v", hb.Targets[1])
	}
	// 组件字段仍应正常透传。
	if len(hb.Components) != 1 || hb.Components[0].Type != contract.ComponentTypeCollector {
		t.Fatalf("components not carried: %+v", hb.Components)
	}
}

func testConfig(endpoint string) *config.Config {
	c := config.Defaults()
	c.CenterEndpoint = endpoint
	c.NetworkDomainID = "gov-cloud-a"
	c.Token = "tok"
	return c
}

// testServer 模拟中心：/heartbeat 返回 config_changed；/config 返回指定 zip/状态。
type testServer struct {
	srv       *httptest.Server
	zipBody   []byte
	configErr int // 若 >0 返回该状态码
	resp      contract.HeartbeatResponse
}

func newTestServer(hb contract.HeartbeatResponse, zipBody []byte) *testServer {
	ts := &testServer{zipBody: zipBody, resp: hb}
	ts.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if err := json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "data": ts.resp}); err != nil {
				http.Error(w, "encode error", http.StatusInternalServerError)
			}
			return
		}
		if ts.configErr > 0 {
			w.WriteHeader(ts.configErr)
			return
		}
		w.Write(ts.zipBody)
	}))
	return ts
}

func newPuller(cfg *config.Config, ts *testServer, deploy Deployer, rt RuntimeProvider) *Puller {
	cli := client.NewClient(cfg, token.NewStore(cfg.Token), logger.New(nil))
	return NewPuller(cfg, token.NewStore(cfg.Token), cli, rt, deploy, logger.New(nil), nil, "")
}

func newPullerWithRestart(cfg *config.Config, ts *testServer, deploy Deployer, rt RuntimeProvider, onRestart func() error, statePath string) *Puller {
	cli := client.NewClient(cfg, token.NewStore(cfg.Token), logger.New(nil))
	return NewPuller(cfg, token.NewStore(cfg.Token), cli, rt, deploy, logger.New(nil), onRestart, statePath)
}

func TestRunOnceValidConfigDeploysAndRetains(t *testing.T) {
	valid := buildZip(t, "scrape: 1", "")
	hb := contract.HeartbeatResponse{ConfigChanged: true, ConfigVersion: "v1", ConfigDownloadURL: "http://x/config"}
	ts := newTestServer(hb, valid)
	defer ts.srv.Close()

	dep := &fakeDeploy{}
	cfg := testConfig(ts.srv.URL)
	cfg.CenterEndpoint = ts.srv.URL + "/base"
	// heartbeat 路径固定拼接；这里用真实 server（其 handler 对任意 path 返回心跳/配置）。
	// 为模拟 config_download_url 指向同一 server，用 ts.srv.URL 即可。
	hb2 := contract.HeartbeatResponse{ConfigChanged: true, ConfigVersion: "v1", ConfigDownloadURL: ts.srv.URL + "/cfg"}
	ts.resp = hb2

	p := newPuller(cfg, ts, dep, fakeRuntime{snap: RuntimeSnapshot{AgentVersion: "v0.2.0"}})
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if dep.count() != 1 {
		t.Fatalf("deploy count = %d want 1", dep.count())
	}
	if len(p.LastValidConfig()) == 0 {
		t.Fatal("last valid config not retained")
	}
	if p.LastValidMetadata() == nil || p.LastValidMetadata().ConfigVersion != "20260918-120000" {
		t.Fatalf("last valid metadata wrong: %+v", p.LastValidMetadata())
	}
}

func TestRunOnceChecksumMismatchRetainsLastValid(t *testing.T) {
	valid := buildZip(t, "scrape: 1", "")
	bad := buildZip(t, "scrape: 2", "deadbeef") // metadata.checksum 与内容不符

	hb := contract.HeartbeatResponse{ConfigChanged: true, ConfigDownloadURL: "http://x/cfg"}
	ts := newTestServer(hb, valid)
	defer ts.srv.Close()

	dep := &fakeDeploy{}
	cfg := testConfig(ts.srv.URL)
	p := newPuller(cfg, ts, dep, nil)
	p.cfg = cfg

	// 第一轮拉取有效配置。
	ts.zipBody = valid
	ts.resp = contract.HeartbeatResponse{ConfigChanged: true, ConfigDownloadURL: ts.srv.URL + "/cfg"}
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	firstValid := append([]byte(nil), p.LastValidConfig()...)
	if dep.count() != 1 {
		t.Fatalf("first deploy count = %d", dep.count())
	}

	// 第二轮：中心返回坏配置，checksum 校验失败 → 保留第一轮有效配置、不落盘。
	ts.zipBody = bad
	ts.resp = contract.HeartbeatResponse{ConfigChanged: true, ConfigDownloadURL: ts.srv.URL + "/cfg"}
	if err := p.RunOnce(context.Background()); err == nil {
		// 允许返回错误；关键是保留与不落盘。
	}
	if dep.count() != 1 {
		t.Fatalf("bad config should not deploy, count = %d", dep.count())
	}
	if !bytes.Equal(p.LastValidConfig(), firstValid) {
		t.Fatal("last valid config should be retained (first) after checksum failure")
	}
}

func TestVerifyChecksumValidAndMismatch(t *testing.T) {
	valid := buildZip(t, "scrape: 1", "")
	if _, err := VerifyChecksum(valid); err != nil {
		t.Fatalf("valid zip should pass: %v", err)
	}

	bad := buildZip(t, "scrape: 1", "wrongchecksum")
	if _, err := VerifyChecksum(bad); err == nil {
		t.Fatal("expected checksum mismatch")
	}
}

// TestBuildHeartbeatCarriesMetadataParams 校验 buildHeartbeat 透传当前生效 metadata
// 回传参数指纹（F-42：随心跳上报供中心比对网域参数变更）。
func TestBuildHeartbeatCarriesMetadataParams(t *testing.T) {
	cfg := testConfig("http://center:8080")
	rt := fakeRuntime{snap: RuntimeSnapshot{
		ConfigVersion:              "v1",
		MetadataRemoteWriteURL:     "http://center:9090/api/v1/write",
		MetadataMaxDiskUsagePerURL: "50GB",
	}}
	p := newPuller(cfg, nil, nil, rt)
	hb := p.buildHeartbeat()
	if hb.MetadataRemoteWriteURL != "http://center:9090/api/v1/write" {
		t.Fatalf("metadata_remote_write_url = %q", hb.MetadataRemoteWriteURL)
	}
	if hb.MetadataMaxDiskUsagePerURL != "50GB" {
		t.Fatalf("metadata_max_disk_usage_per_url = %q", hb.MetadataMaxDiskUsagePerURL)
	}
}

// TestRunOnceParamsChangedForcesPull 覆盖 F-42 参数传播：网域回传参数变更时中心
// 不改 config_version（config_changed=false）仅返回 params_changed=true，Agent 也
// 必须强制拉包；params_changed=false 时不拉。
func TestRunOnceParamsChangedForcesPull(t *testing.T) {
	valid := buildZip(t, "scrape: 1", "")
	ts := newTestServer(contract.HeartbeatResponse{}, valid)
	defer ts.srv.Close()

	dep := &fakeDeploy{}
	cfg := testConfig(ts.srv.URL)
	p := newPuller(cfg, ts, dep, nil)

	// config_changed=false + params_changed=false → 不拉包。
	ts.resp = contract.HeartbeatResponse{ConfigVersion: "v1"}
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if dep.count() != 0 {
		t.Fatalf("no-params-change should not pull, deploy count = %d", dep.count())
	}

	// config_changed=false + params_changed=true → 强制拉包并 deploy。
	ts.resp = contract.HeartbeatResponse{ConfigVersion: "v1", ParamsChanged: true, ConfigDownloadURL: ts.srv.URL + "/cfg"}
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if dep.count() != 1 {
		t.Fatalf("params_changed=true should force pull, deploy count = %d", dep.count())
	}

	// config_changed=true 依旧拉包（原路径回归）。
	ts.resp = contract.HeartbeatResponse{ConfigChanged: true, ConfigVersion: "v2", ConfigDownloadURL: ts.srv.URL + "/cfg"}
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if dep.count() != 2 {
		t.Fatalf("config_changed=true should pull, deploy count = %d", dep.count())
	}
}

func TestRunOnceNetworkErrorRetainsAndRecovers(t *testing.T) {
	dep := &fakeDeploy{}
	cfg := testConfig("")
	cfg.CenterEndpoint = "http://127.0.0.1:1" // 不可达 → 网络错误
	p := newPuller(cfg, nil, dep, nil)
	cli := client.NewClient(cfg, token.NewStore(cfg.Token), logger.New(nil))
	p.client = cli

	// 断网首轮：心跳请求失败，尚无可保留的有效配置，返回错误即可（不 panic）。
	if err := p.RunOnce(context.Background()); err == nil {
		t.Fatal("network error expected")
	}
	if dep.count() != 0 {
		t.Fatal("no deploy on network error")
	}

	// 复现「先成功持有有效配置，再断网应保留」：
	// 先把 endpoint 指向可达 server 拉一份有效配置，再切回不可达，验证 lastValid 被保留。
	reachable := buildZip(t, "scrape: v9", "")
	ts := newTestServer(contract.HeartbeatResponse{ConfigChanged: true, ConfigDownloadURL: "http://up/cfg"}, reachable)
	defer ts.srv.Close()
	cfg.CenterEndpoint = ts.srv.URL
	p2 := newPuller(cfg, ts, dep, nil)
	cli2 := client.NewClient(cfg, token.NewStore(cfg.Token), logger.New(nil))
	p2.client = cli2
	ts.resp = contract.HeartbeatResponse{ConfigChanged: true, ConfigDownloadURL: ts.srv.URL + "/cfg"}
	if err := p2.RunOnce(context.Background()); err != nil {
		t.Fatalf("reachable apply should succeed: %v", err)
	}
	retained := append([]byte(nil), p2.LastValidConfig()...)
	if len(retained) == 0 {
		t.Fatal("expected a retained valid config")
	}

	// 切换为不可达 endpoint 再跑一轮：应保留上一步 valid 配置。
	cfg.CenterEndpoint = "http://127.0.0.1:1"
	p2.client = client.NewClient(cfg, token.NewStore(cfg.Token), logger.New(nil))
	if err := p2.RunOnce(context.Background()); err == nil {
		t.Fatal("network error expected post-recovery")
	}
	if !bytes.Equal(p2.LastValidConfig(), retained) {
		t.Fatal("last valid config should be retained across network outage")
	}
}

// TestRunOnceRestartSeqTriggersCallbackAndPersists 覆盖 F-42 人工重启指令：心跳响应
// seq 大于本地已执行序号时执行回调并落盘；重复心跳（seq 未递增）不重复执行（幂等）；
// agent 重启后从磁盘恢复 seq，不重复执行。
func TestRunOnceRestartSeqTriggersCallbackAndPersists(t *testing.T) {
	ts := newTestServer(contract.HeartbeatResponse{}, nil)
	defer ts.srv.Close()

	cfg := testConfig(ts.srv.URL)
	statePath := t.TempDir() + "/restart-state.json"
	calls := 0
	p := newPullerWithRestart(cfg, ts, &fakeDeploy{}, nil, func() error {
		calls++
		return nil
	}, statePath)

	// 第一轮：中心下发 seq=5 → 回调执行 1 次，seq 落盘。
	ts.resp = contract.HeartbeatResponse{VMAgentRestartSeq: 5}
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("restart callback calls = %d want 1", calls)
	}
	if p.executedRestartSeq != 5 {
		t.Fatalf("executedRestartSeq = %d want 5", p.executedRestartSeq)
	}
	b, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("restart state not persisted: %v", err)
	}
	var st restartState
	if err := json.Unmarshal(b, &st); err != nil || st.ExecutedVMAgentRestartSeq != 5 {
		t.Fatalf("restart state = %s err=%v", b, err)
	}

	// 第二轮：同一 seq（未递增）→ 不重复执行（幂等）。
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("duplicate heartbeat re-triggered restart, calls = %d", calls)
	}

	// 模拟 agent 重启：从磁盘恢复 seq，同一 seq 不再执行。
	p2 := newPullerWithRestart(cfg, ts, &fakeDeploy{}, nil, func() error {
		calls++
		return nil
	}, statePath)
	if p2.executedRestartSeq != 5 {
		t.Fatalf("restored executedRestartSeq = %d want 5", p2.executedRestartSeq)
	}
	ts.resp = contract.HeartbeatResponse{VMAgentRestartSeq: 5}
	if err := p2.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("restart re-executed after agent restart, calls = %d", calls)
	}

	// seq 再递增（5→6）→ 新一轮指令执行。
	ts.resp = contract.HeartbeatResponse{VMAgentRestartSeq: 6}
	if err := p2.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || p2.executedRestartSeq != 6 {
		t.Fatalf("incremented seq not executed: calls=%d seq=%d", calls, p2.executedRestartSeq)
	}
}

// TestRunOnceRestartSeqFailureRetries 覆盖失败重试语义：回调失败不推进 seq、不落盘，
// 下轮心跳对同一 seq 自动重试；成功后推进。
func TestRunOnceRestartSeqFailureRetries(t *testing.T) {
	ts := newTestServer(contract.HeartbeatResponse{}, nil)
	defer ts.srv.Close()

	cfg := testConfig(ts.srv.URL)
	statePath := t.TempDir() + "/restart-state.json"
	fail := true
	calls := 0
	p := newPullerWithRestart(cfg, ts, &fakeDeploy{}, nil, func() error {
		calls++
		if fail {
			return errors.New("restart failed")
		}
		return nil
	}, statePath)

	ts.resp = contract.HeartbeatResponse{VMAgentRestartSeq: 3}
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("first attempt calls = %d want 1", calls)
	}
	if p.executedRestartSeq != 0 {
		t.Fatalf("failed restart must not advance seq, got %d", p.executedRestartSeq)
	}
	if _, err := os.Stat(statePath); !os.IsNotExist(err) {
		t.Fatalf("failed restart must not persist state, stat err = %v", err)
	}

	// 下轮心跳：同一 seq 重试，这次成功。
	fail = false
	if err := p.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if calls != 2 || p.executedRestartSeq != 3 {
		t.Fatalf("retry not executed: calls=%d seq=%d", calls, p.executedRestartSeq)
	}
	b, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("restart state not persisted after success: %v", err)
	}
	var st restartState
	if err := json.Unmarshal(b, &st); err != nil || st.ExecutedVMAgentRestartSeq != 3 {
		t.Fatalf("restart state = %s err=%v", b, err)
	}
}
