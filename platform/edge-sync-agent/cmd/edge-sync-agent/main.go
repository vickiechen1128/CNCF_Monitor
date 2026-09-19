// Command edge-sync-agent 是部署在边缘监控代理节点的独立守护进程（Module_11）。
//
// 职责（PRD §6.4）：读配置 → 每 30s 心跳上报 → center 判定 config_changed 时拉取
// 配置包 → 校验 checksum → deployer 原子落盘 + reload → supervisor 守护采集器 /
// 拨测器进程（存活+健康双判定、指数退避重启、熔断 crash_loop、blackbox 先于 collector）。
//
// 运行方式：
//
//	edge-sync-agent                                  # 守护运行（读环境变量）
//	edge-sync-agent -version | -help
//
// 环境变量（必填）：NETWORK_DOMAIN_ID / TOKEN / CENTER_ENDPOINT；
// 可选：EDGE_CONFIG_ROOT（默认 /opt/apps/edge-sync-agent/edge-config）、
// EDGE_AGENT_TYPE / EDGE_AGENT_VERSION、EDGE_WAL_DIR、
// EDGE_COLLECTOR_BIN / EDGE_BLACKBOX_BIN、EDGE_PROM_HEALTH_URL /
// EDGE_PROM_RELOAD_URL、EDGE_BLACKBOX_ADDR。systemd 部署见 packaging/service。
package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/metriccenter/platform/edge-sync-agent/internal/client"
	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/deployer"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/puller"
	"github.com/metriccenter/platform/edge-sync-agent/internal/supervisor"
	"github.com/metriccenter/platform/edge-sync-agent/internal/token"
)

// version 由打包时覆盖（-ldflags -X main.version=...）。
var version = "v0.2.0"

func main() {
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Printf("edge-sync-agent %s (%s/%s, module_11 v0.2)\n", version, runtime.GOOS, runtime.GOARCH)
		return
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "edge-sync-agent:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logg := logger.New(logger.SyslogOrStderr())
	defer logg.Close()

	// 部署根目录：可写默认 /opt/apps/edge-sync-agent/edge-config（开发期用
	// EDGE_CONFIG_ROOT 覆盖为相对/其它目录）。配置包版本目录落其下。
	configRoot := envOr("EDGE_CONFIG_ROOT", "/opt/apps/edge-sync-agent/edge-config")
	if err := os.MkdirAll(configRoot, 0o755); err != nil {
		return fmt.Errorf("create config root %s: %w", configRoot, err)
	}

	// 组装顺序：探针先于 deployer（探针持有 configDir 闭包，延迟读取 dep），
	// reload 回调引用探针信号。保持零循环依赖。
	var dep *deployer.Deployer
	var sv *supervisor.Supervisor
	probe := NewProcProbe(func() string {
		if dep == nil {
			return ""
		}
		return dep.CurrentDir()
	}, os.Stderr)

	promReload := func(ctx context.Context, _ deployer.ComponentType, _ string) error {
		// 本地采集器优先 SIGHUP（vmagent 热加载）；进程未起时回落 vmagent HTTP /-/reload。
		if err := probe.Signal(contract.ComponentTypeCollector, syscall.SIGHUP); err == nil {
			return nil
		}
		return httpPostOK(ctx, probe.httpc, envOr("EDGE_PROM_RELOAD_URL", "http://127.0.0.1:8429/-/reload"))
	}
	bbReload := func(ctx context.Context, _ deployer.ComponentType, _ string) error {
		// 配置包含 blackbox.yml 后，先把 blackbox_exporter 纳入守护集（首次拉包时组件集
		// 在启动期固定、不含 blackbox），再由 supervisor tick 拉起并 SIGHUP reload。
		restoreComponents(sv, dep, cfg)
		return probe.Signal(contract.ComponentTypeBlackbox, syscall.SIGHUP)
	}

	dep = deployer.New(configRoot, cfg.NetworkDomainID, logg, nil, promReload, bbReload)

	// 崩溃恢复：重启后从磁盘恢复上次生效 config_version（供心跳上报）。
	if err := dep.Restore(); err != nil {
		logg.Warnf("deployer restore failed: %v", err)
	}

	sv = supervisor.NewSupervisor(supervisor.DefaultParams(), probe, logg)

	// 恢复后把已生效配置版本回填到 supervisor 组件（心跳 config_version + 进程启动指向）。
	restoreComponents(sv, dep, cfg)

	hostname, _ := os.Hostname()
	ip := localIP()
	rt := &runtimeProvider{cfg: cfg, deployer: dep, sv: sv, hostname: hostname, ip: ip}

	tok := token.NewStore(cfg.Token)
	cli := client.NewClient(cfg, tok, logg)
	pl := puller.NewPuller(cfg, tok, cli, rt, dep, logg)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 立即执行一轮守护与心跳，避免首个 10s/30s 空窗。
	sv.StepOnce(ctx)
	go sv.Run(ctx)
	go pl.Run(ctx)
	logg.Infof("edge-sync-agent started: domain=%s type=%s center=%s config_root=%s version=%s",
		cfg.NetworkDomainID, cfg.AgentType, cfg.CenterEndpoint, configRoot, version)

	// 优雅退出：收到 SIGINT/SIGTERM → 取消上下文 → 停止采集/拉包与子进程。
	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, syscall.SIGINT, syscall.SIGTERM)
	<-sigc
	logg.Infof("shutdown signal received, stopping children")
	cancel()
	probe.StopAll()
	return nil
}

// restoreComponents 把当前生效配置版本同步到 supervisor 组件描述（供心跳 config_version
// 上报，并作为进程启动指向的参考）。blackbox 可选组件仅在包内含有 blackbox.yml 时才启用。
func restoreComponents(sv *supervisor.Supervisor, dep *deployer.Deployer, cfg *config.Config) {
	want := []contract.Component{}
	ver := dep.CurrentVersion()
	collector := contract.Component{
		Type:          contract.ComponentTypeCollector,
		Name:          "collector",
		Version:       cfg.Version,
		ConfigVersion: ver,
	}
	if ver != "" && hasBlackboxYML(dep, ver) {
		want = append(want, contract.Component{
			Type:          contract.ComponentTypeBlackbox,
			Name:          "blackbox_exporter",
			Version:       envOr("EDGE_BLACKBOX_VERSION", "dev"),
			ConfigVersion: ver,
		})
	}
	// collector 始终启用（agent 必须守护采集器）。
	want = append(want, collector)
	sv.Reconcile(want)
}

func hasBlackboxYML(dep *deployer.Deployer, ver string) bool {
	p := filepath.Join(dep.VersionDir(ver), contract.ZipEntryBlackbox)
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// localIP 返回本机首选出口 IP（用于心跳上报 ip），不可得时返回空串。
func localIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return ""
	}
	defer conn.Close()
	if udp, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return udp.IP.String()
	}
	return ""
}
