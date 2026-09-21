package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/supervisor"
)

func TestHTTPGetOK200AndNon200(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ok.Close()
	if err := httpGetOK(context.Background(), ok.Client(), ok.URL); err != nil {
		t.Fatalf("200 should pass: %v", err)
	}

	fail := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer fail.Close()
	if err := httpGetOK(context.Background(), fail.Client(), fail.URL); err == nil {
		t.Fatal("non-200 should fail health check")
	}
}

func TestHTTPPostOKReload(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s want POST", r.Method)
		}
		got = r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	if err := httpPostOK(context.Background(), srv.Client(), srv.URL+"/-/reload"); err != nil {
		t.Fatalf("reload should pass: %v", err)
	}
	if got != "/-/reload" {
		t.Fatalf("reload path = %s", got)
	}
}

func TestTCPProbe(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		c, err := ln.Accept()
		if err == nil {
			c.Close()
		}
	}()
	if err := tcpProbe(context.Background(), ln.Addr().String()); err != nil {
		t.Fatalf("open port should pass: %v", err)
	}
	// 关闭后探活失败。
	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	addr := closed.Listener.Addr().String()
	closed.Close()
	if err := tcpProbe(context.Background(), addr); err == nil {
		t.Fatal("closed port should fail probe")
	}
}

func TestProcProbeSignalWhenNotRunning(t *testing.T) {
	cfgDir := func() string { return "" }
	p := NewProcProbe(cfgDir, "", nil)
	c := &supervisor.Component{Type: contract.ComponentTypeCollector}
	if p.Alive(c) {
		t.Fatal("should not be alive before start")
	}
	if err := p.Signal(contract.ComponentTypeCollector, syscall.SIGUSR1); err == nil {
		t.Fatal("signal on not-running component should error")
	}
	// 无生效配置版本时 Start 应报错，不 panic。
	if err := p.Start(&supervisor.Component{Type: contract.ComponentTypeBlackbox}); err == nil {
		t.Fatal("start without config dir should error")
	}
}

func TestProcProbeTimeoutSetting(t *testing.T) {
	p := NewProcProbe(func() string { return "" }, "", nil)
	if p.httpc == nil || p.httpc.Timeout != 3*time.Second {
		t.Fatalf("http client timeout not set: %+v", p.httpc)
	}
}

// TestResolveRemoteWriteURL 覆盖 remote_write_url 四档解析优先级（T11-G1-02）：
// 配置包 metadata（B）> EDGE_REMOTE_WRITE_URL env > center_endpoint 推导（A）> 环回兜底。
func TestResolveRemoteWriteURL(t *testing.T) {
	const loopback = "http://127.0.0.1:9090/api/v1/write"

	// 档 1：配置包 metadata 下发的 remote_write_url 最高优先。
	t.Run("metadata wins", func(t *testing.T) {
		got := resolveRemoteWriteURL("http://center:9090/api/v1/write", "http://any:8080")
		if got != "http://center:9090/api/v1/write" {
			t.Fatalf("metadata url = %q", got)
		}
	})

	// 档 2：metadata 为空时，显式 env 优先于 center_endpoint 推导。
	t.Run("env overrides center derivation", func(t *testing.T) {
		t.Setenv("EDGE_REMOTE_WRITE_URL", "http://env:8428/api/v1/write")
		got := resolveRemoteWriteURL("", "http://center:8080")
		if got != "http://env:8428/api/v1/write" {
			t.Fatalf("env url = %q", got)
		}
	})

	// 档 3：无 metadata、无 env 时由 center_endpoint 推导（去尾斜杠 + /api/v1/write）。
	t.Run("center endpoint derived", func(t *testing.T) {
		t.Setenv("EDGE_REMOTE_WRITE_URL", "")
		got := resolveRemoteWriteURL("", "http://center:8080")
		want := "http://center:8080/api/v1/write"
		if got != want {
			t.Fatalf("derived url = %q want %q", got, want)
		}
		// 尾斜杠应被去除，避免双斜杠。
		gotTrim := resolveRemoteWriteURL("", "http://center:8080/")
		if gotTrim != want {
			t.Fatalf("derived url with trailing slash = %q want %q", gotTrim, want)
		}
	})

	// 档 4：全部落空时回退环回兜底（保证 vmagent -remoteWrite.url 非空）。
	t.Run("loopback fallback", func(t *testing.T) {
		t.Setenv("EDGE_REMOTE_WRITE_URL", "")
		got := resolveRemoteWriteURL("", "")
		if got != loopback {
			t.Fatalf("loopback url = %q", got)
		}
	})
}

// TestMetadataRemoteWriteURL 校验从生效配置目录 metadata.json 读取 remote_write_url，
// 缺失文件 / 字段为空 / 目录为空时返回空串。
func TestMetadataRemoteWriteURL(t *testing.T) {
	// 空目录 → 空串。
	if got := metadataRemoteWriteURL(""); got != "" {
		t.Fatalf("empty versionDir = %q", got)
	}

	dir := t.TempDir()
	// 无 metadata.json → 空串。
	if got := metadataRemoteWriteURL(dir); got != "" {
		t.Fatalf("missing metadata = %q", got)
	}

	// 含 remote_write_url 的 metadata.json → 读取到该地址。
	if err := os.WriteFile(filepath.Join(dir, contract.ZipEntryMetadata),
		[]byte(`{"config_version":"v1","remote_write_url":"http://center:9090/api/v1/write"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := metadataRemoteWriteURL(dir); got != "http://center:9090/api/v1/write" {
		t.Fatalf("metadata url = %q", got)
	}

	// 不合法 JSON → 安全回落空串。
	bad := filepath.Join(t.TempDir(), contract.ZipEntryMetadata)
	if err := os.WriteFile(bad, []byte(`{invalid`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := metadataRemoteWriteURL(filepath.Dir(bad)); got != "" {
		t.Fatalf("invalid json url = %q", got)
	}
}
