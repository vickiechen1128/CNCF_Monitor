package deployer

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
)

const validProm = `
global:
  scrape_interval: 30s
scrape_configs:
  - job_name: app
    file_sd_configs:
      - files:
          - targets/app.json
`

// buildZip 构造配置包 zip（metadata.checksum 由外部计算，此处不重算——deployer
// 不校验 checksum，仅结构校验，故任意值即可）。
func buildZip(t *testing.T, prom string, targets map[string]string, rules, blackbox string) []byte {
	t.Helper()
	meta := contract.Metadata{
		ConfigVersion: "v1",
		GeneratedAt:   "2026-09-18T12:00:00Z",
		AgentType:     "vmagent",
		Checksum:      "deadbeef",
	}
	mj, _ := json.Marshal(meta)
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	add := func(name, data string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		w.Write([]byte(data))
	}
	add(contract.ZipEntryPrometheus, prom)
	for n, c := range targets {
		add("targets/"+n, c)
	}
	if rules != "" {
		add(contract.ZipEntryRules, rules)
	}
	if blackbox != "" {
		add(contract.ZipEntryBlackbox, blackbox)
	}
	add(contract.ZipEntryMetadata, string(mj))
	zw.Close()
	return buf.Bytes()
}

func defaultTargets() map[string]string {
	return map[string]string{
		"app.json": `[{"targets":["10.0.0.1:9100"],"labels":{"job":"app"}}]`,
	}
}

type rec struct {
	mu      sync.Mutex
	calls   int
	lastCmp ComponentType
}

func (r *rec) reload(_ context.Context, c ComponentType, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	r.lastCmp = c
	return nil
}
func (r *rec) count() int { r.mu.Lock(); defer r.mu.Unlock(); return r.calls }

func newDeployer(t *testing.T, promRel, bbRel Reloader) (*Deployer, string) {
	t.Helper()
	dir := t.TempDir()
	var pr Reloader
	var br Reloader
	if promRel != nil {
		pr = promRel
	}
	if bbRel != nil {
		br = bbRel
	}
	d := New(dir, "gov-cloud-a", logger.New(nil), nil, pr, br)
	return d, dir
}

func TestApplyAtomicSwitch(t *testing.T) {
	promRel := &rec{}
	d, root := newDeployer(t, promRel.reload, nil)
	zipB := buildZip(t, validProm, defaultTargets(), "", "")
	meta := &contract.Metadata{ConfigVersion: "v1"}
	ctx := context.Background()
	if err := d.Apply(ctx, zipB, meta); err != nil {
		t.Fatal(err)
	}
	// 幂等字段更新、版本目录存在、内容落盘。
	if d.CurrentVersion() != "v1" {
		t.Fatalf("current version = %s", d.CurrentVersion())
	}
	verDir := d.VersionDir("v1")
	promPath := filepath.Join(verDir, "prometheus.yml")
	b, err := os.ReadFile(promPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "scrape_configs") {
		t.Fatal("prometheus.yml content not written")
	}
	if _, err := os.Stat(filepath.Join(verDir, "targets", "app.json")); err != nil {
		t.Fatalf("targets file not written: %v", err)
	}
	if _, err := os.Stat(filepath.Join(verDir, "metadata.json")); err != nil {
		t.Fatalf("metadata.json not written: %v", err)
	}
	// 首次应用 prometheus.yml 变化 → collector reload 一次。
	if promRel.count() != 1 {
		t.Fatalf("prom reload count = %d want 1", promRel.count())
	}
	// 无 staging 残留。
	if _, err := os.Stat(filepath.Join(root, "config-gov-cloud-a", ".staging")); !os.IsNotExist(err) {
		t.Fatal("staging dir should be cleaned after switch")
	}
}

func TestApplyIdempotentSameVersion(t *testing.T) {
	promRel := &rec{}
	d, _ := newDeployer(t, promRel.reload, nil)
	zipB := buildZip(t, validProm, defaultTargets(), "", "")
	meta := &contract.Metadata{ConfigVersion: "v1"}
	ctx := context.Background()
	if err := d.Apply(ctx, zipB, meta); err != nil {
		t.Fatal(err)
	}
	if err := d.Apply(ctx, zipB, meta); err != nil {
		t.Fatal(err)
	}
	if promRel.count() != 1 {
		t.Fatalf("idempotent: reload count = %d want 1", promRel.count())
	}
}

func TestApplyTargetsInvalidRollback(t *testing.T) {
	d, root := newDeployer(t, nil, nil)
	// targets 为非法 JSON → StructuralValidate 失败 → 不落盘、保留旧配置。
	bad := defaultTargets()
	bad["app.json"] = `[{"targets":[123]}]` // targets 非字符串数组
	zipB := buildZip(t, validProm, bad, "", "")
	meta := &contract.Metadata{ConfigVersion: "bad"}
	if err := d.Apply(context.Background(), zipB, meta); err == nil {
		t.Fatal("expected validation error for invalid targets")
	}
	if d.CurrentVersion() != "" {
		t.Fatalf("should not switch on invalid config, got version %s", d.CurrentVersion())
	}
	// 验证旧可运行配置保留：直接检查无版本目录 / staging 被清理。
	if _, err := os.Stat(d.VersionDir("bad")); !os.IsNotExist(err) {
		t.Fatal("invalid version dir should not exist")
	}
	if _, err := os.Stat(filepath.Join(root, "config-gov-cloud-a", ".staging")); !os.IsNotExist(err) {
		t.Fatal("staging should be cleaned after validation failure")
	}
}

func TestApplyReloadOnlyOnPromChange(t *testing.T) {
	promRel := &rec{}
	d, _ := newDeployer(t, promRel.reload, nil)

	// v1：prometheus.yml=A，触发 reload。
	if err := d.Apply(context.Background(), buildZip(t, validProm, defaultTargets(), "", ""), &contract.Metadata{ConfigVersion: "v1"}); err != nil {
		t.Fatal(err)
	}
	// v2：prometheus.yml 不变只需新 targets → 不触发 collector reload（file_sd 感知）。
	zipV2 := buildZip(t, validProm, map[string]string{"app.json": `[{"targets":["10.0.0.2:9100"]}]`}, "", "")
	if err := d.Apply(context.Background(), zipV2, &contract.Metadata{ConfigVersion: "v2"}); err != nil {
		t.Fatal(err)
	}
	if promRel.count() != 1 {
		t.Fatalf("prom reload should not trigger on targets-only change, count = %d", promRel.count())
	}
	// v3：prometheus.yml 变 → 再次 reload。
	if err := d.Apply(context.Background(), buildZip(t, validProm+"  - job_name: extra\n", defaultTargets(), "", ""), &contract.Metadata{ConfigVersion: "v3"}); err != nil {
		t.Fatal(err)
	}
	if promRel.count() != 2 {
		t.Fatalf("prom reload count = %d want 2", promRel.count())
	}
}

func TestApplyBlackboxTriggersReload(t *testing.T) {
	bbRel := &rec{}
	d, _ := newDeployer(t, nil, bbRel.reload)
	blackbox := "modules:\n  http_2xx:\n    prober: http\n"
	if err := d.Apply(context.Background(), buildZip(t, validProm, defaultTargets(), "", blackbox), &contract.Metadata{ConfigVersion: "v1"}); err != nil {
		t.Fatal(err)
	}
	if bbRel.count() != 1 {
		t.Fatalf("blackbox reload count = %d want 1", bbRel.count())
	}
	if bbRel.lastCmp != ComponentBlackbox {
		t.Fatalf("last blackbox comp = %s", bbRel.lastCmp)
	}
}

func TestApplyMissingPrometheusRejected(t *testing.T) {
	d, _ := newDeployer(t, nil, nil)
	// prometheus.yml 为空 → extract 报错，不落盘。
	if err := d.Apply(context.Background(), buildZip(t, "", nil, "", ""), &contract.Metadata{ConfigVersion: "v1"}); err == nil {
		t.Fatal("expected error for missing prometheus.yml")
	}
}

func TestVerifyTargetsJSON(t *testing.T) {
	if err := ValidateTargetsJSON("ok.json", `[{"targets":["10.0.0.1:9100"]}]`); err != nil {
		t.Fatal(err)
	}
	if err := ValidateTargetsJSON("lbl.json", `[{"targets":["1.2.3.4:80"],"labels":{"l":"v"}}]`); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{
		`not json`,
		`[]`,
		`["x"]`,
		`[{"labels":{}}]`,
		`[{"targets":"s"}]`,
	} {
		if err := ValidateTargetsJSON("bad.json", bad); err == nil {
			t.Fatalf("expected error for %q", bad)
		}
	}
}

func TestStructuralValidateTopKeys(t *testing.T) {
	pkg := &Package{
		PrometheusYML: "scrape_configs:\n  - job_name: x\n",
		RulesYML:      "groups:\n  - name: g\n",
		BlackboxYML:   "modules:\n  a:\n    prober: tcp\n",
		Targets:       defaultTargets(),
	}
	if err := StructuralValidate(pkg); err != nil {
		t.Fatal(err)
	}
}

// TestZipSlipTargetRejected 回归：targets 文件名被篡改为路径穿越 / 绝对路径时，
// extractPackage 必须拒绝落盘，防止 zip-slip 越界写宿主文件系统。
func TestZipSlipTargetRejected(t *testing.T) {
	cases := []string{
		"../evil.json",
		"a/../../evil.json",
		"/etc/cron.d/evil",
		"..",
	}
	for _, name := range cases {
		var buf bytes.Buffer
		zw := zip.NewWriter(&buf)
		add := func(n, data string) {
			w, err := zw.Create(n)
			if err != nil {
				t.Fatal(err)
			}
			w.Write([]byte(data))
		}
		add(contract.ZipEntryPrometheus, validProm)
		add("targets/"+name, `[{"targets":["10.0.0.1:9100"]}]`)
		add(contract.ZipEntryMetadata, `{"config_version":"v1"}`)
		zw.Close()

		if _, err := extractPackage(buf.Bytes(), nil); err == nil {
			t.Errorf("zip-slip name %q should be rejected", name)
		}
	}
}
