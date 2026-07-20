// simple-agent 是 MetricCenter 的采集端 Agent 模板。
//
// 该示例演示如何使用 prometheus/client_golang 暴露 /metrics 端点，
// 供 Prometheus Server 通过 pull 模式抓取指标。
//
// 启动方式：
//   go run main.go -listen-address ":9100" -app-name "order-service" -env "prod"
//
// 在 MetricCenter 中，可基于该 Agent 创建“采集模板”，自动生成对应的 scrape_config。
package main

import (
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
	// 命令行参数
	listenAddr = flag.String("listen-address", ":9100", "监听地址，例如 :9100")
	appName    = flag.String("app-name", "demo-app", "应用名，会作为 app label")
	appGroup   = flag.String("app-group", "demo-group", "应用分组，会作为 app_group label")
	env        = flag.String("env", "dev", "环境名，会作为 env label")
	cluster    = flag.String("cluster", "default", "集群名，会作为 cluster label")

	// 固定标签，会附加到所有指标上
	constLabels prometheus.Labels

	// 示例指标：HTTP 请求总数（Counter）
	requestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name:        "demo_http_requests_total",
			Help:        "HTTP 请求总数",
			ConstLabels: constLabels,
		},
		[]string{"method", "status"},
	)

	// 示例指标：当前活跃连接数（Gauge）
	activeConnections = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Name:        "demo_active_connections",
			Help:        "当前活跃连接数",
			ConstLabels: constLabels,
		},
	)

	// 示例指标：请求处理耗时（Histogram）
	requestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:        "demo_http_request_duration_seconds",
			Help:        "HTTP 请求处理耗时（秒）",
			ConstLabels: constLabels,
			Buckets:     prometheus.DefBuckets,
		},
		[]string{"method"},
	)
)

func init() {
	flag.Parse()

	constLabels = prometheus.Labels{
		"app":       *appName,
		"app_group": *appGroup,
		"env":       *env,
		"cluster":   *cluster,
	}

	// 注册指标
	prometheus.MustRegister(requestsTotal)
	prometheus.MustRegister(activeConnections)
	prometheus.MustRegister(requestDuration)
}

func main() {
	http.Handle("/metrics", promhttp.Handler())
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprintln(w, "ok")
	})

	// 模拟业务指标变化，实际场景中应替换为真实业务逻辑埋点
	go simulateMetrics()

	log.Printf("simple-agent starting on %s", *listenAddr)
	log.Printf("labels: app=%s app_group=%s env=%s cluster=%s", *appName, *appGroup, *env, *cluster)
	log.Fatal(http.ListenAndServe(*listenAddr, nil))
}

// simulateMetrics 模拟生成一些指标数据，用于验证采集链路。
// 真实业务中，应把这些埋点放到实际的处理逻辑中。
func simulateMetrics() {
	methods := []string{"GET", "POST", "PUT"}
	statuses := []string{"200", "404", "500"}

	for {
		method := methods[rand.Intn(len(methods))]
		status := statuses[rand.Intn(len(statuses))]

		requestsTotal.WithLabelValues(method, status).Inc()
		requestDuration.WithLabelValues(method).Observe(rand.Float64() * 0.5)

		delta := rand.Float64()*10 - 5
		activeConnections.Add(delta)

		time.Sleep(2 * time.Second)
	}
}
