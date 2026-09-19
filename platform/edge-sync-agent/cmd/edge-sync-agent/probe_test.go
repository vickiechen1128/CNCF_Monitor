package main

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
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
	p := NewProcProbe(cfgDir, nil)
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
	p := NewProcProbe(func() string { return "" }, nil)
	if p.httpc == nil || p.httpc.Timeout != 3*time.Second {
		t.Fatalf("http client timeout not set: %+v", p.httpc)
	}
}
