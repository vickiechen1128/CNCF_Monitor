package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// metricsWithFailures 模拟本机 vmagent /metrics：remote_write 有错误/推送失败/重试计数，
// 且有待发送积压。指标名取自 upstream/victoria-metrics/app/vmagent/remotewrite 实际
// RegisterMetric 字面量（vmagent_remotewrite_*，remotewrite 连写）。
const metricsWithFailures = `# HELP vmagent_remotewrite_errors_total Total number of errors occurred when sending remote write requests.
# TYPE vmagent_remotewrite_errors_total counter
vmagent_remotewrite_errors_total 3
# HELP vmagent_remotewrite_push_failures_total Number of push failures.
# TYPE vmagent_remotewrite_push_failures_total counter
vmagent_remotewrite_push_failures_total 2
# HELP vmagent_remotewrite_retries_count_total Number of retries.
# TYPE vmagent_remotewrite_retries_count_total counter
vmagent_remotewrite_retries_count_total 7
# HELP vmagent_remotewrite_pending_data_bytes Amount of data pending to be sent.
# TYPE vmagent_remotewrite_pending_data_bytes gauge
vmagent_remotewrite_pending_data_bytes{path="/opt/data/vmagent-cache/persistent-queue/1_ABC",url="1:secret-url"} 43915725039
`

// metricsNoFailures 模拟 remote_write 无失败、有少量积压（正常排队态）。
const metricsNoFailures = `# TYPE vmagent_remotewrite_errors_total counter
vmagent_remotewrite_errors_total 0
# TYPE vmagent_remotewrite_push_failures_total counter
vmagent_remotewrite_push_failures_total 0
# TYPE vmagent_remotewrite_retries_count_total counter
vmagent_remotewrite_retries_count_total 0
# TYPE vmagent_remotewrite_pending_data_bytes gauge
vmagent_remotewrite_pending_data_bytes{path="/opt/data/vmagent-cache/persistent-queue/1_ABC",url="1:secret-url"} 2048
`

// TestParsePromGauge 覆盖带 label 与不带 label 两种形态，并校验多分片取最大值
// （而非累加——各队列分片独立存储，累加会重复计数）。
func TestParsePromGauge(t *testing.T) {
	body := `# HELP x help
# TYPE x counter
x_total 5
x_total{reason="a"} 3
x_total{reason="b"} 4

vmagent_remotewrite_errors_total 9
vmagent_remotewrite_pending_data_bytes{path="/p1",url="u"} 100
vmagent_remotewrite_pending_data_bytes{path="/p2",url="u"} 250
`
	if v, ok := parsePromGauge(body, metricRWErrors); !ok || v != 9 {
		t.Fatalf("errors_total = (%g,%v) want (9,true)", v, ok)
	}
	// 带 label 分片行取 max=5（不是 3+4=7，避免重复累加）
	if v, ok := parsePromGauge(body, "x_total"); !ok || v != 5 {
		t.Fatalf("x_total = (%g,%v) want (5,true)", v, ok)
	}
	// 积压两分片 100/250 → 取 max=250
	if v, ok := parsePromGauge(body, metricRWPendingBytes); !ok || v != 250 {
		t.Fatalf("pending = (%g,%v) want (250,true)", v, ok)
	}
	if _, ok := parsePromGauge(body, "not_exist_metric"); ok {
		t.Fatal("missing metric should report found=false")
	}
}

// TestFetchVMAgentRemoteWriteStats 有失败时返回失败摘要 + 积压字节数。
func TestFetchVMAgentRemoteWriteStats(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/metrics" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write([]byte(metricsWithFailures))
	}))
	defer srv.Close()

	got := fetchVMAgentRemoteWriteStats(context.Background(), srv.Client(), srv.URL, nil)
	if !got.OK {
		t.Fatal("expected OK=true")
	}
	if got.PendingBytes != 43915725039 {
		t.Fatalf("PendingBytes = %d want 43915725039", got.PendingBytes)
	}
	for _, want := range []string{
		"remote_write_failed",
		"vmagent_remotewrite_errors_total=3",
		"vmagent_remotewrite_push_failures_total=2",
		"vmagent_remotewrite_retries_count_total=7",
	} {
		if !strings.Contains(got.LastError, want) {
			t.Fatalf("LastError %q missing %q", got.LastError, want)
		}
	}
}

// TestFetchVMAgentRemoteWriteStatsNoFailure 无失败时：LastError 空，但积压照常上报。
// 这是用户诉求「区分程序坏了 vs 只是积压自愈中」的关键：无失败 + 有积压 = 正在排队。
func TestFetchVMAgentRemoteWriteStatsNoFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(metricsNoFailures))
	}))
	defer srv.Close()

	got := fetchVMAgentRemoteWriteStats(context.Background(), srv.Client(), srv.URL, nil)
	if !got.OK {
		t.Fatal("expected OK=true")
	}
	if got.LastError != "" {
		t.Fatalf("expected empty LastError on no failure, got %q", got.LastError)
	}
	if got.PendingBytes != 2048 {
		t.Fatalf("PendingBytes = %d want 2048", got.PendingBytes)
	}
}

// TestFetchVMAgentRemoteWriteStatsDegrades 采集失败（非200 / 连接失败 / 无指标）
// 必须降级为 OK=false，绝不阻断心跳；尤其「指标不存在」不得误报成「上报正常」。
func TestFetchVMAgentRemoteWriteStatsDegrades(t *testing.T) {
	srv500 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv500.Close()
	if got := fetchVMAgentRemoteWriteStats(context.Background(), srv500.Client(), srv500.URL, nil); got.OK {
		t.Fatal("http500 should degrade to OK=false")
	}

	// 连接失败（端口 1 无监听）
	if got := fetchVMAgentRemoteWriteStats(context.Background(), &http.Client{}, "http://127.0.0.1:1", nil); got.OK {
		t.Fatal("conn refused should degrade to OK=false")
	}

	// 200 但无任何 remote_write 指标（老版本 vmagent 未暴露 / 路径变更）
	srvNoMetric := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("# nothing here\n"))
	}))
	defer srvNoMetric.Close()
	got := fetchVMAgentRemoteWriteStats(context.Background(), srvNoMetric.Client(), srvNoMetric.URL, nil)
	if got.OK {
		t.Fatal("missing metrics should degrade to OK=false")
	}
	if got.PendingBytes != 0 || got.LastError != "" {
		t.Fatalf("degraded stats should be zero/empty, got %d/%q", got.PendingBytes, got.LastError)
	}
}
