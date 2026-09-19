package puller

import (
	"bytes"
	"archive/zip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	return NewPuller(cfg, token.NewStore(cfg.Token), cli, rt, deploy, logger.New(nil))
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
