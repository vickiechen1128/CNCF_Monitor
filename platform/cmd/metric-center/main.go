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
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/admin/networkdomain"
	"github.com/metriccenter/metriccenter/platform/admin/tenant"
	"github.com/metriccenter/metriccenter/platform/admin/user"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/config/label"
	"github.com/metriccenter/metriccenter/platform/config/resource"
	"github.com/metriccenter/metriccenter/platform/configcenter"
	"github.com/metriccenter/metriccenter/platform/configcenter/change"
	"github.com/metriccenter/metriccenter/platform/configcenter/deployment"
	"github.com/metriccenter/metriccenter/platform/dashboard"
	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/query"
	"github.com/metriccenter/metriccenter/platform/strategy"
)

var (
	listenAddr              = flag.String("listen-address", ":8080", "MetricCenter HTTP 监听地址")
	prometheusURL           = flag.String("prometheus.url", "http://localhost:9090", "Prometheus 查询地址")
	businessDomainsFile     = flag.String("business-domains.file", "platform/config/business_domains.yaml", "业务分组字典 yaml 路径")
	configDir               = flag.String("config.dir", "./config-output", "local 下发目标：中心 Prometheus 配置目录（写盘 + file_sd targets）")
	configReloadURL         = flag.String("config.reload-url", "", "中心 Prometheus reload 地址（如 http://localhost:9090/-/reload）；结构文件变更后触发，为空时如实报错而非静默 success")
	webStaticDir            = flag.String("web.static-dir", "", "前端静态产物目录（如 web/ui-custom）；非空时由 metric-center 直接托管，UI 与 API 同源单端口（部署拓扑方案 A2），为空则不托管（开发态行为不变）")
	changeDetectMinInterval = flag.Duration("change-detect.min-interval", 5*time.Second, "M09 §3.3.3 配置变更检测最小间隔（可用环境变量 CONFIG_CHANGE_DETECT_MIN_INTERVAL_SECONDS 覆盖，单位秒）")
	changeDetectMaxInterval = flag.Duration("change-detect.max-interval", 120*time.Second, "M09 §3.3.3 配置变更检测最大间隔（可用环境变量 CONFIG_CHANGE_DETECT_MAX_INTERVAL_SECONDS 覆盖，单位秒）；原 CONFIG_CHANGE_DETECT_INTERVAL_SECONDS 也映射为最大间隔")
)

func main() {
	flag.Parse()

	// M09 变更检测自适应间隔：环境变量优先（单位秒），未配置时用 flag 默认值。
	// 为兼容旧配置，CONFIG_CHANGE_DETECT_INTERVAL_SECONDS 也作为最大间隔。
	if v := os.Getenv("CONFIG_CHANGE_DETECT_INTERVAL_SECONDS"); v != "" {
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			*changeDetectMaxInterval = time.Duration(sec) * time.Second
		}
	}
	if v := os.Getenv("CONFIG_CHANGE_DETECT_MIN_INTERVAL_SECONDS"); v != "" {
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			*changeDetectMinInterval = time.Duration(sec) * time.Second
		}
	}
	if v := os.Getenv("CONFIG_CHANGE_DETECT_MAX_INTERVAL_SECONDS"); v != "" {
		if sec, err := strconv.Atoi(v); err == nil && sec > 0 {
			*changeDetectMaxInterval = time.Duration(sec) * time.Second
		}
	}
	if *changeDetectMaxInterval < *changeDetectMinInterval {
		*changeDetectMaxInterval = *changeDetectMinInterval
	}

	// 优雅退出：监听 SIGINT/SIGTERM，取消 ctx 以停下变更检测 watcher，并 Shutdown HTTP 服务。
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	promURL, err := parseURL(*prometheusURL)
	if err != nil {
		log.Fatalf("invalid prometheus.url: %v", err)
	}

	if err := db.Init(); err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}

	// HIGH-1 / T09-06 运行期装配：local 通道经 *DiskApplier 写中心 Prometheus 配置目录
	// 并 trigger reload；未配置 reload 地址时走 buildReloadFunc 如实报错（不伪成功）。
	// 默认 noopApplier 仅服务于内存/测试环境（集成测试不调用 main，仍为 no-op）。
	deployment.DefaultApplier = &deployment.DiskApplier{
		Dir:    *configDir,
		Reload: buildReloadFunc(*configReloadURL),
	}

	// M09 §3.3.3：启动自适应配置变更检测轮询（方案 A，闭环补缺），随 ctx 优雅退出。
	change.Start(ctx, db.DB, *changeDetectMinInterval, *changeDetectMaxInterval)

	r, err := setupRouter(promURL, *webStaticDir)
	if err != nil {
		log.Fatalf("failed to setup router: %v", err)
	}

	srv := &http.Server{Addr: *listenAddr, Handler: r}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown error: %v", err)
		}
	}()

	log.Printf(">>> metric-center listening on %s", *listenAddr)
	log.Printf(">>> prometheus proxy target: %s", promURL.String())
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("failed to start metric-center: %v", err)
	}
}

// setupRouter 装配控制面路由。staticDir 非空时额外托管前端静态产物（A2 同源部署）。
func setupRouter(promURL *url.URL, staticDir string) (*gin.Engine, error) {
	r := gin.Default()
	// A2 同源部署下 CORS 中间件实际不生效（前后端同域），保留仅为兼容 S2 拆分前
	// 的直连场景与开发态跨端口调试；演进到 S2（nginx 反代）后应移除或收紧为白名单。
	r.Use(cors.Default())

	// au-02 全局认证中间件（交集：POST /api/v2/platform/auth/login、
	// /api/v1/health* 与 OPTIONS 预检放行，其余 /api/* 须携带有效 Bearer token）。
	// 中间件仅认证、不授权（无角色/权限点校验）。
	r.Use(auth.AuthMiddleware(auth.NewService(auth.NewRepository(db.DB))))

	apiV1 := r.Group("/api/v1")
	registerHealthRoutes(apiV1)
	registerPrometheusProxyRoutes(apiV1, promURL)
	// M02 采集状态路由（决策 47）：/api/v1/targets（代理）+ /api/v1/health/coverage（聚合）。
	query.RegisterRoutes(apiV1, promURL)

	apiV2 := r.Group("/api/v2")
	registerPlatformConfigRoutes(apiV2)

	// A2 部署拓扑：静态兜底必须最后注册，保证所有 /api/* 路由优先命中。
	if staticDir != "" {
		if err := registerSPA(r, staticDir); err != nil {
			return nil, err
		}
		log.Printf(">>> serving frontend static files from %s", staticDir)
	}

	return r, nil
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

	// Module 06 Phase 1: zone-type dictionary + network-domain registry.
	networkdomain.RegisterRoutes(platform, db.DB)

	// H-2：管理后台接口（/users*、/login-logs*、/tenants*）额外挂载 RequireAdmin
	// 最小授权门，仅平台管理员可访问；/auth/* 及其它模块保持仅全局认证（au-02）。
	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())

	// Module 06 (tu-03): user administration + login-log query.
	user.RegisterRoutes(admin, db.DB)

	// Module 06 (au-02): tenant administration + auth endpoints. 路由分别为
	// /tenants* 与 /auth/*，与既有 user(/users*、/login-logs)、
	// networkdomain(/network-domains*、/zone-types*) 无路径冲突；旧
	// networkdomain 中的 /tenants 已移除。租户管理属管理后台，挂 RequireAdmin；
	// 认证 endpoints（/auth/*）仍注册在 platform 根组（仅全局认证）。
	tenant.RegisterRoutes(admin, db.DB)
	auth.RegisterRoutes(platform, db.DB)

	// Module 07 (T07-18 收口): business-domain dictionary (read-only, yaml preset
	// + hot reload), resource CRUD / Excel template & import / resource labels /
	// import records / label-templates, all under /api/v2/platform/*.
	businessStore := resource.NewBusinessDomainStore(*businessDomainsFile)
	resource.RegisterRoutes(platform, db.DB, businessStore)
	label.RegisterRoutes(platform, db.DB)

	// Module 01 (T01-09 收口): 监控策略——采集器模板 + 默认采集配置 + 采集 Job
	// （实例候选/安装确认/预览）+ 规则挂载 + 技术指标库，均在 /api/v2/platform/* 下。
	strategy.RegisterRoutes(platform, db.DB)

	// Module 09 (T09-07 收口): 网域与边缘配置中心——网域监控纳管、配置草稿、
	// 配置版本与下发记录（含 retry/rollback），统一挂载到 /api/v2/platform/*。
	// 旧 /api/v2/platform/config/preview|apply 占位在此收敛（实现在 configcenter/draft、deployment）。
	configcenter.RegisterRoutes(platform, db.DB)

	// 首页 Dashboard 聚合接口：一次性聚合资源 / 草稿 / 下发记录 / 网域统计。
	platform.GET("/dashboard/summary", dashboard.SummaryHandler(db.DB))
}

// registerSPA 在 Gin 上托管前端构建产物，实现 UI 与 API 同源（部署拓扑方案 A2，
// 见 docs/06-mvp-e2e-testing/frontend-backend-deploy-topology.md）。
//
// 路由优先级与行为：
//   - 已注册的 /api/* 路由在 NoRoute 之前命中，不受影响；
//   - 未命中的 /api/* 请求返回 404 JSON，**不**落入静态兜底——否则会把 API 404
//     伪装成 200 + index.html，前端按 JSON 解析失败且掩盖真实问题。
//     注意 auth.AuthMiddleware 先于本兜底执行，因此未携带 token 的 /api/* 请求
//     会先拿到 401，404 分支对已认证请求生效。这是更安全的分层：匿名请求无法
//     通过「404 vs 401」探测哪些 API 路径真实存在。
//   - 存在对应文件的路径（如 /assets/index-*.js）直接返回文件（含目录穿越防护）；
//   - 其余路径（含 / 与前端 history 子路由）fallback 到 index.html，交给前端路由。
func registerSPA(r *gin.Engine, dir string) error {
	root, err := filepath.Abs(dir)
	if err != nil {
		return fmt.Errorf("resolve web.static-dir %q: %w", dir, err)
	}
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("web.static-dir %q: %w", root, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("web.static-dir %q: not a directory", root)
	}
	indexPath := filepath.Join(root, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return fmt.Errorf("web.static-dir %q: %w", root, err)
	}

	fileServer := http.FileServer(http.Dir(root))
	inside := root + string(os.PathSeparator)

	r.NoRoute(func(c *gin.Context) {
		reqPath := c.Request.URL.Path
		if reqPath == "/api" || strings.HasPrefix(reqPath, "/api/") {
			response.NotFound(c, "api route not found: "+reqPath)
			return
		}
		// path.Clean 归一化 .. 后再拼接，配合前缀校验阻断目录穿越。
		target := filepath.Join(root, filepath.FromSlash(path.Clean(reqPath)))
		if strings.HasPrefix(target, inside) {
			if fi, err := os.Stat(target); err == nil && !fi.IsDir() {
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}
		c.File(indexPath)
	})
	return nil
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

// buildReloadFunc 返回供 *DiskApplier 使用的 reload 回调：POST 到中心 Prometheus
// reload 地址（/-/reload 以上游为准）。未配置 reloadURL 时如实返回错误而非静默
// success——避免 HIGH-1 修复前“不 reload 却记 success”的伪成功。
func buildReloadFunc(reloadURL string) func() error {
	client := &http.Client{Timeout: 10 * time.Second}
	return func() error {
		if reloadURL == "" {
			return errors.New("config reload url not configured; refusing silent success")
		}
		u, err := url.Parse(reloadURL)
		if err != nil {
			return fmt.Errorf("parse reload url: %w", err)
		}
		if u.Scheme != "http" && u.Scheme != "https" {
			return fmt.Errorf("parse reload url %q: scheme must be http or https", reloadURL)
		}
		if u.Host == "" {
			return fmt.Errorf("parse reload url %q: host must not be empty", reloadURL)
		}
		resp, err := client.Post(reloadURL, "application/json", nil)
		if err != nil {
			return fmt.Errorf("reload prometheus at %s: %w", reloadURL, err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
			return fmt.Errorf("reload prometheus at %s: unexpected status %d", reloadURL, resp.StatusCode)
		}
		return nil
	}
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
