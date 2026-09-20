package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/supervisor"
)

// procSpec 描述一个被守护组件的真实进程启动/探活参数。随部署形态演进（vmagent /
// blackbox_exporter）可在装配时替换 bin 与 args 模板（决策 C4：采集器统一为 vmagent）。
type procSpec struct {
	typ    string                           // collector / blackbox_exporter（对齐 contract.ComponentType）
	bin    string                           // 可执行文件路径（在 PATH 或绝对路径）
	args   func(versionDir string) []string // 由生效配置目录派生启动参数
	health func(ctx context.Context) error  // 健康检查（HTTP /-/healthy 或 TCP 探活）
}

// ProcProbe 是 supervisor.Probe 的真实实现：管理本地子进程存活 + 健康/探活双判定。
//
//	Alive   子进程已 Start 且未退出
//	Healthy collector 探 HTTP /-/healthy；blackbox 探 TCP 端口
//	Start   拉起子进程（指向 deployer 当前生效配置目录）
//	Stop    终止子进程
type ProcProbe struct {
	mu        sync.Mutex
	specs     map[string]*procSpec
	cmds      map[string]*exec.Cmd // typ -> 运行中子进程
	configDir func() string        // 返回当前生效配置目录（deployer.VersionDir(CurrentVersion)）
	httpc     *http.Client
	out       io.Writer
}

// NewProcProbe 构造探针。configDir 返回 deployer 当前生效版本目录；envBin 允许用
// EDGE_* 环境覆盖采集器 / 拨测器二进制路径。
func NewProcProbe(configDir func() string, out io.Writer) *ProcProbe {
	p := &ProcProbe{
		specs:     map[string]*procSpec{},
		cmds:      map[string]*exec.Cmd{},
		configDir: configDir,
		httpc:     &http.Client{Timeout: 3 * time.Second},
		out:       out,
	}
	collBin := envOr("EDGE_COLLECTOR_BIN", "vmagent")
	bbBin := envOr("EDGE_BLACKBOX_BIN", "blackbox_exporter")
	// 决策 88：采集器统一为 vmagent，默认 HTTP 监听 8429（探活 /health、reload /-/reload）。
	vmHTTP := envOr("EDGE_COLLECTOR_ADDR", "127.0.0.1:8429")
	promURL := envOr("EDGE_PROM_HEALTH_URL", "http://127.0.0.1:8429/health")
	bbAddr := envOr("EDGE_BLACKBOX_ADDR", "127.0.0.1:9115")

	p.specs[contract.ComponentTypeCollector] = &procSpec{
		typ: contract.ComponentTypeCollector,
		bin: collBin,
		args: func(versionDir string) []string {
			// vmagent 参数：-promscrape.config 指向当前生效配置目录；指标经 remote write
			// 上报中心（默认中心 Prometheus /api/v1/write，需 --web.enable-remote-write-receiver；
			// 连接失败时 vmagent 本地缓存并退避重试，健康探活不受影响）；缓存落 EDGE_WAL_DIR。
			// 注意：vmagent 强制要求至少一个 -remoteWrite.url，故不可传空值。
			rwURL := envOr("EDGE_REMOTE_WRITE_URL", "http://127.0.0.1:9090/api/v1/write")
			return []string{
				"-promscrape.config=" + filepath.Join(versionDir, contract.ZipEntryPrometheus),
				"-httpListenAddr=" + vmHTTP,
				"-remoteWrite.url=" + rwURL,
				"-remoteWrite.tmpDataPath=" + envOr("EDGE_WAL_DIR", filepath.Join(versionDir, "vmagent-cache")),
			}
		},
		health: func(ctx context.Context) error {
			return httpGetOK(ctx, p.httpc, promURL)
		},
	}
	p.specs[contract.ComponentTypeBlackbox] = &procSpec{
		typ: contract.ComponentTypeBlackbox,
		bin: bbBin,
		args: func(versionDir string) []string {
			return []string{
				"--config.file=" + filepath.Join(versionDir, contract.ZipEntryBlackbox),
				"--web.listen-address=" + bbAddr,
			}
		},
		health: func(ctx context.Context) error {
			return tcpProbe(ctx, bbAddr)
		},
	}
	return p
}

// Alive 实现 supervisor.Probe：进程已启动且仍在运行。
func (p *ProcProbe) Alive(c *supervisor.Component) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	cmd := p.cmds[c.Type]
	return cmd != nil && cmd.Process != nil && cmd.ProcessState == nil
}

// Healthy 实现 supervisor.Probe：进程存活前提下执行 HTTP/TCP 探活。
func (p *ProcProbe) Healthy(c *supervisor.Component) bool {
	spec, ok := p.specs[c.Type]
	if !ok {
		return false
	}
	return spec.health(context.Background()) == nil
}

// Start 实现 supervisor.Probe：拉起子进程，指向当前生效配置目录。
func (p *ProcProbe) Start(c *supervisor.Component) error {
	spec, ok := p.specs[c.Type]
	if !ok {
		return fmt.Errorf("probe: no spec for component %s", c.Type)
	}
	vd := p.configDir()
	if vd == "" {
		return errors.New("probe: no effective config version to start from")
	}
	cmd := exec.Command(spec.bin, spec.args(vd)...)
	cmd.Stdout = p.out
	cmd.Stderr = p.out
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("probe: start %s (%s) failed: %w", c.Type, spec.bin, err)
	}
	p.mu.Lock()
	p.cmds[c.Type] = cmd
	p.mu.Unlock()
	return nil
}

// Stop 实现 supervisor.Probe：终止子进程。
func (p *ProcProbe) Stop(c *supervisor.Component) error {
	p.mu.Lock()
	cmd := p.cmds[c.Type]
	p.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	_ = cmd.Process.Kill()
	_ = cmd.Wait()
	p.mu.Lock()
	delete(p.cmds, c.Type)
	p.mu.Unlock()
	return nil
}

// Signal 向指定类型组件进程发送信号（deployer reload 触发用）。
func (p *ProcProbe) Signal(typ string, sig syscall.Signal) error {
	p.mu.Lock()
	cmd := p.cmds[typ]
	p.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("probe: component %s not running", typ)
	}
	return cmd.Process.Signal(sig)
}

// StopAll 优雅停止全部子进程（main 退出时调用）。
func (p *ProcProbe) StopAll() {
	p.mu.Lock()
	types := make([]string, 0, len(p.cmds))
	for t := range p.cmds {
		types = append(types, t)
	}
	p.mu.Unlock()
	for _, t := range types {
		p.Stop(&supervisor.Component{Type: t})
	}
}

func httpGetOK(ctx context.Context, cli *http.Client, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := cli.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("health %d", resp.StatusCode)
	}
	return nil
}

func httpPostOK(ctx context.Context, cli *http.Client, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return err
	}
	resp, err := cli.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("reload http %d", resp.StatusCode)
	}
	return nil
}

func tcpProbe(ctx context.Context, addr string) error {
	d := net.Dialer{Timeout: 2 * time.Second}
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	_ = conn.Close()
	return nil
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
