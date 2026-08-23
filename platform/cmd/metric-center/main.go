// metric-center 是 MetricCenter 控制面的主程序入口。
//
// MVP 阶段提供：
//   - 健康检查接口（含数据库连通性）
//   - 配置管理 API 占位
//   - Prometheus Query API 代理
//
// 后续逐步接入 CMDB、标签模板、采集模板、配置下发等业务模块。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/admin/networkdomain"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/config/label"
	"github.com/metriccenter/metriccenter/platform/config/resource"
	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/strategy"
)

var (
	listenAddr          = flag.String("listen-address", ":8080", "MetricCenter HTTP 监听地址")
	prometheusURL       = flag.String("prometheus.url", "http://localhost:9090", "Prometheus 查询地址")
	businessDomainsFile = flag.String("business-domains.file", "platform/config/business_domains.yaml", "业务分组字典 yaml 路径")
)

func main() {
	flag.Parse()

	promURL, err := parseURL(*prometheusURL)
	if err != nil {
		log.Fatalf("invalid prometheus.url: %v", err)
	}

	if err := db.Init(); err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}

	r := setupRouter(promURL)

	log.Printf(">>> metric-center listening on %s", *listenAddr)
	log.Printf(">>> prometheus proxy target: %s", promURL.String())
	if err := r.Run(*listenAddr); err != nil {
		log.Fatalf("failed to start metric-center: %v", err)
	}
}

func setupRouter(promURL *url.URL) *gin.Engine {
	r := gin.Default()

	apiV1 := r.Group("/api/v1")
	registerHealthRoutes(apiV1)
	registerPrometheusProxyRoutes(apiV1, promURL)

	apiV2 := r.Group("/api/v2")
	registerPlatformConfigRoutes(apiV2)

	return r
}

func registerHealthRoutes(g *gin.RouterGroup) {
	g.GET("/health", healthHandler)
	g.GET("/health/db", healthDBHandler)
	g.GET("/status", statusHandler)
}

func registerPrometheusProxyRoutes(g *gin.RouterGroup, promURL *url.URL) {
	proxy := newPrometheusProxy(promURL)
	h := prometheusProxyHandler(proxy)
	for _, route := range []string{"/query", "/query_range", "/labels", "/label/:name/values", "/series"} {
		g.Any(route, h)
	}
}

func registerPlatformConfigRoutes(g *gin.RouterGroup) {
	platform := g.Group("/platform")
	config := platform.Group("/config")
	config.GET("/preview", configPreviewHandler)
	config.POST("/apply", configApplyHandler)

	// Module 06 Phase 1: zone-type dictionary + network-domain registry.
	networkdomain.RegisterRoutes(platform, db.DB)

	// Module 07 (T07-18 收口): business-domain dictionary (read-only, yaml preset
	// + hot reload), resource CRUD / Excel template & import / resource labels /
	// import records / label-templates, all under /api/v2/platform/*.
	businessStore := resource.NewBusinessDomainStore(*businessDomainsFile)
	resource.RegisterRoutes(platform, db.DB, businessStore)
	label.RegisterRoutes(platform, db.DB)

	// Module 01 (T01-09 收口): 监控策略——采集器模板 + 默认采集配置 + 采集 Job
	// （实例候选/安装确认/预览）+ 规则挂载 + 技术指标库，均在 /api/v2/platform/* 下。
	strategy.RegisterRoutes(platform, db.DB)
}

func healthHandler(c *gin.Context) {
	response.OK(c, gin.H{
		"status":    "ok",
		"service":   "metric-center",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func healthDBHandler(c *gin.Context) {
	if err := db.Health(); err != nil {
		response.InternalServerError(c, err)
		return
	}
	response.OK(c, gin.H{
		"status":    "ok",
		"db_status": "connected",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}

func statusHandler(c *gin.Context) {
	response.OK(c, gin.H{
		"version": "0.1.0-mvp",
		"mode":    "mvp",
	})
}

func configPreviewHandler(c *gin.Context) {
	response.OK(c, gin.H{
		"prometheus_yml": "# TODO: 根据 CMDB + 标签模板生成\n",
	})
}

func configApplyHandler(c *gin.Context) {
	response.OK(c, gin.H{"ok": true, "message": "配置下发接口占位"})
}

func prometheusProxyHandler(proxy *httputil.ReverseProxy) gin.HandlerFunc {
	return func(c *gin.Context) {
		// TODO: 在转发前完成租户/用户认证与查询范围隔离。
		log.Printf("prometheus proxy forward: method=%s path=%s", c.Request.Method, c.Request.URL.Path)
		proxy.ServeHTTP(&safeResponseWriter{ResponseWriter: c.Writer}, c.Request)
	}
}

func newPrometheusProxy(target *url.URL) *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("prometheus proxy error: method=%s path=%s error=%v", r.Method, r.URL.Path, err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(response.Error(err))
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		log.Printf("prometheus proxy response: method=%s path=%s status=%d", resp.Request.Method, resp.Request.URL.Path, resp.StatusCode)
		return nil
	}
	return proxy
}

// parseURL parses raw and validates that the URL uses an allowed scheme
// (http or https) and has a non-empty host.
func parseURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse url %q: %w", raw, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("parse url %q: scheme must be http or https", raw)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("parse url %q: host must not be empty", raw)
	}
	return u, nil
}

// safeResponseWriter wraps gin.ResponseWriter to provide a non-panicking
// CloseNotify implementation for consumers that type-assert http.CloseNotifier.
type safeResponseWriter struct {
	gin.ResponseWriter
}

func (w *safeResponseWriter) CloseNotify() <-chan bool {
	ch := make(chan bool, 1)
	return ch
}
