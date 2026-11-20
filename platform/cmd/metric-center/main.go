// metric-center 是 MetricCenter 控制面的主程序入口。
//
// v2.0 rewrite 起生产二进制只提供 v3-only 入口：legacy v2 路由、后台任务与
// SQLite 驱动均不参与编译。--database.mode 仅为兼容旧启动脚本保留，取值
// 为空或 v3 时直接使用 v3 入口；其余取值记录警告后同样走 v3。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/foundation/apiresponse"
)

var (
	listenAddr          = flag.String("listen-address", ":8080", "MetricCenter HTTP 监听地址")
	prometheusURL       = flag.String("prometheus.url", "http://localhost:9090", "Prometheus 查询地址")
	businessDomainsFile = flag.String("business-domains.file", "platform/config/business_domains.yaml", "业务分组字典 yaml 路径")
	configDir           = flag.String("config.dir", "./config-output", "local 下发目标：中心 Prometheus 配置目录（写盘 + file_sd targets）")
	alertmanagerURL     = flag.String("alertmanager.url", "http://localhost:9093", "中心 Alertmanager HTTP 地址（M08 静默代理 + AM 配置下发 reload 目标）")
	notifyBridgeURL     = flag.String("notify.bridge-url", "", "通知渲染桥基础地址覆盖（默认由 --listen-address 推导）")
	configAMDir         = flag.String("config.am-dir", "", "local 下发目标：中心 Alertmanager 配置目录；为空时复用 config.dir")
	configAMReloadURL   = flag.String("config.am-reload-url", "", "中心 Alertmanager reload 地址；为空时默认 alertmanager.url 的 /-/reload")
	webStaticDir        = flag.String("web.static-dir", "", "前端静态产物目录；非空时由 metric-center 直接托管，UI 与 API 同源单端口")
	edgePackageDir      = flag.String("edge-packages.dir", "dist/edge-package", "边缘离线交付包目录（环境变量 EDGE_PACKAGE_DIR 可覆盖）")
	databaseMode        = flag.String("database.mode", "", "兼容性保留：仅支持 v3（留空亦为 v3）")
)

// registerDeprecatedFlags keeps accepting the flags that existing launch
// scripts (Makefile / scripts/package-center.sh) still pass. The v3 entry has
// no consumer for them, so the values are intentionally discarded.
func registerDeprecatedFlags() {
	_ = flag.String("config.reload-url", "", "已废弃：v3 不再使用，仅为兼容旧启动脚本保留")
	_ = flag.String("notify.render-timezone", "", "已废弃：v3 不再使用，仅为兼容旧启动脚本保留")
	_ = flag.Duration("change-detect.min-interval", 5*time.Second, "已废弃：v3 不再使用，仅为兼容旧启动脚本保留")
	_ = flag.Duration("change-detect.max-interval", 30*time.Second, "已废弃：v3 不再使用，仅为兼容旧启动脚本保留")
}

func main() {
	registerDeprecatedFlags()
	flag.Parse()

	if v := os.Getenv("EDGE_PACKAGE_DIR"); v != "" {
		*edgePackageDir = v
	}
	if v := os.Getenv("NOTIFY_BRIDGE_URL"); v != "" {
		*notifyBridgeURL = v
	}

	// 兼容旧脚本的 --database.mode / METRIC_CENTER_DB_MODE：v3-only 二进制
	// 不再提供 legacy 启动分支，任何非 v3 取值只记录警告。
	if mode := strings.ToLower(strings.TrimSpace(*databaseMode)); mode != "" && mode != "v3" {
		log.Printf("WARN: --database.mode=%q is no longer supported; running v3-only", mode)
	}
	if mode := strings.ToLower(strings.TrimSpace(os.Getenv("METRIC_CENTER_DB_MODE"))); mode != "" && mode != "v3" {
		log.Printf("WARN: METRIC_CENTER_DB_MODE=%q is no longer supported; running v3-only", mode)
	}

	// 优雅退出：取消 ctx 以停下后台 watcher 并 Shutdown HTTP 服务。
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	runV3(ctx)
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

// registerSPA 在 Gin 上托管前端构建产物，实现 UI 与 API 同源（部署拓扑方案 A2）。
//
// 路由优先级与行为：
//   - 已注册的 /api/* 路由在 NoRoute 之前命中，不受影响；
//   - 未命中的 /api/* 请求返回 404 JSON，**不**落入静态兜底；
//   - 存在对应文件的路径直接返回文件（含目录穿越防护）；
//   - 其余路径 fallback 到 index.html，交给前端路由。
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
