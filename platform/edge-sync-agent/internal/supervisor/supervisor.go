// Package supervisor 实现 Edge Sync Agent 内的进程守护（PRD §6.4.2 / §8.4）：
// 组件注册表 + 存活/健康双判定 + 指数退避重启 + 熔断 crash_loop + 启动顺序编排
// （blackbox_exporter 先于 collector）。
//
// 本包仅 stdlib + internal 契约，零第三方 / 零控制面依赖。进程存活探针（进程信号 /
// HTTP /-/healthy 探活）通过 Probe 接口注入，真实进程维da由 T11-15 main 装配接入，
// 本包以接口隔离保证可单测。
package supervisor

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
)

// Params 是守护工程化参数（PRD §6.4.2）。
type Params struct {
	HealthInterval   time.Duration // 健康检查间隔，默认 10s
	BackoffMin       time.Duration // 重启退避起点，默认 5s
	BackoffMax       time.Duration // 退避封顶，默认 60s
	BreakerWindow    time.Duration // 熔断滚动窗口，默认 10min
	BreakerThreshold int           // 窗口内重启次数阈值，默认 5
}

// DefaultParams 返回 PRD §6.4.2 的默认参数。
func DefaultParams() Params {
	return Params{
		HealthInterval:   10 * time.Second,
		BackoffMin:       5 * time.Second,
		BackoffMax:       60 * time.Second,
		BreakerWindow:    10 * time.Minute,
		BreakerThreshold: 5,
	}
}

// Probe 是进程级抽象，由外围注入真实实现；单测用假实现驱动状态机。
//
//	Alive   进程存活判定（PID /proc/[pid] 或 process.Wait）
//	Healthy 健康检查判定（collector 探 /-/healthy、blackbox 探 TCP 端口）
//	Start   拉起进程（成功后置 running）
//	Stop    停进程（编排/升级时用，本期可空实现）
type Probe interface {
	Alive(c *Component) bool
	Healthy(c *Component) bool
	Start(c *Component) error
	Stop(c *Component) error
}

// Component 是注册表中的一个守护组件，字段与 contract.Component 对齐供心跳上报。
type Component struct {
	// 上报字段（对齐 contract.Component，JSON 由 Snapshot 转出）。
	Type          string // agent / collector / blackbox_exporter
	Name          string
	Status        string
	Version       string
	ConfigVersion string
	RestartCount  int
	LastRestartAt string
	LastError     string

	// 运行时内部状态（非上报）。
	enabled      bool
	dependsOn    string      // collector 依赖 blackbox_exporter
	restartTimes []time.Time // 熔断滚动窗口内的重启时刻
	backoff      time.Duration

	mu sync.Mutex
}

// Snapshot 返回该组件上报视图。
func (c *Component) Snapshot() contract.Component {
	c.mu.Lock()
	defer c.mu.Unlock()
	return contract.Component{
		Type:          c.Type,
		Name:          c.Name,
		Status:        c.Status,
		Version:       c.Version,
		ConfigVersion: c.ConfigVersion,
		RestartCount:  c.RestartCount,
		LastRestartAt: c.LastRestartAt,
		LastError:     c.LastError,
	}
}

// Supervisor 持有全部守护组件并按周期执行健康检查/重启/熔断。
type Supervisor struct {
	params Params
	probe  Probe
	logg   *logger.Logger
	clock  func() time.Time
	sleep  func(ctx context.Context, d time.Duration)

	mu    sync.Mutex
	comps map[string]*Component // key=component type
	// order 定义启动编排顺序（PRD §6.4 条目 9：blackbox → collector）。
	order []string
}

// NewSupervisor 构造。probe 不可为 nil；clock / sleep 可注入用于测试（nil 用 time.Now /
// time.Sleep-with-ctx）。
func NewSupervisor(params Params, probe Probe, logg *logger.Logger) *Supervisor {
	if params.HealthInterval <= 0 {
		params.HealthInterval = DefaultParams().HealthInterval
	}
	if params.BackoffMin <= 0 {
		params.BackoffMin = DefaultParams().BackoffMin
	}
	if params.BackoffMax <= 0 {
		params.BackoffMax = DefaultParams().BackoffMax
	}
	if params.BreakerWindow <= 0 {
		params.BreakerWindow = DefaultParams().BreakerWindow
	}
	if params.BreakerThreshold <= 0 {
		params.BreakerThreshold = DefaultParams().BreakerThreshold
	}
	s := &Supervisor{
		params: params,
		probe:  probe,
		logg:   logg,
		comps:  map[string]*Component{},
		order:  []string{contract.ComponentTypeBlackbox, contract.ComponentTypeCollector},
	}
	s.clock = time.Now
	s.sleep = func(ctx context.Context, d time.Duration) {
		t := time.NewTimer(d)
		defer t.Stop()
		select {
		case <-ctx.Done():
		case <-t.C:
		}
	}
	return s
}

// Reconcile 依据期望组件描述（来自 Agent 运行时，deployer 落盘后驱动）同步注册表：
// 设置名称/版本/生效配置版本并启用组件；collector 依赖 blackbox 编排。
func (s *Supervisor) Reconcile(want []contract.Component) {
	for _, w := range want {
		c := s.getOrCreate(w.Type)
		c.mu.Lock()
		c.Name = w.Name
		c.Version = w.Version
		if w.ConfigVersion != "" {
			c.ConfigVersion = w.ConfigVersion
		}
		c.enabled = true
		if c.Type == contract.ComponentTypeCollector {
			c.dependsOn = contract.ComponentTypeBlackbox
		}
		c.mu.Unlock()
	}
}

// getOrCreate 返回指定类型组件，不存在则创建并置初始状态（not_deployed）。
func (s *Supervisor) getOrCreate(typ string) *Component {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.comps[typ]; ok {
		return c
	}
	c := &Component{
		Type:    typ,
		Status:  contract.ComponentStatusNotDeployed,
		backoff: s.params.BackoffMin,
	}
	s.comps[typ] = c
	return c
}

// Get 返回指定类型组件（不存在返回 nil）。
func (s *Supervisor) Get(typ string) *Component {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.comps[typ]
}

// SetProbe 更换探针（测试/运行期）。
func (s *Supervisor) SetInject(clock func() time.Time, sleep func(ctx context.Context, d time.Duration)) {
	s.clock = clock
	if sleep != nil {
		s.sleep = sleep
	}
}

// Snapshot 返回全部启用组件的上报视图（供心跳 RuntimeSnapshot.Components）。
func (s *Supervisor) Snapshot() []contract.Component {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]contract.Component, 0, 2)
	for typ := range s.comps {
		c := s.comps[typ]
		if c.enabled {
			out = append(out, c.Snapshot())
		}
	}
	return out
}

// Run 周期执行健康检查，直到 ctx 取消。
func (s *Supervisor) Run(ctx context.Context) {
	t := time.NewTicker(s.params.HealthInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.StepOnce(ctx)
		}
	}
}

// StepOnce 执行一轮健康检查（对每个启用且非熔断的组件双判定 + 失活重启 + 熔断判定）。
// 单测以 StepOnce 为单位驱动状态机。处理顺序按 s.order 优先级编排（blackbox 先于
// collector），未在 order 中的组件（如 agent 自身）按序追加处理；跨组件依赖阻塞在
// tick 内以运行时 running 判定（collector 等 blackbox）。
func (s *Supervisor) StepOnce(ctx context.Context) {
	s.mu.Lock()
	types := make([]string, 0, len(s.comps))
	for typ, c := range s.comps {
		if c.enabled {
			types = append(types, typ)
		}
	}
	s.mu.Unlock()

	// 按 order 优先级稳定排序：已知类型用其 index，未知类型放最后。
	sort.SliceStable(types, func(i, j int) bool {
		return rank(s.order, types[i]) < rank(s.order, types[j])
	})

	for _, typ := range types {
		s.tick(ctx, typ)
	}
}

// rank 返回类型在 order 中的优先级；不在 order 中者置为较后。
func rank(order []string, typ string) int {
	for i, t := range order {
		if t == typ {
			return i
		}
	}
	return len(order)
}

// tick 处理单个组件的健康检查 / 重启 / 熔断。
func (s *Supervisor) tick(ctx context.Context, typ string) {
	c := s.Get(typ)
	if c == nil {
		return
	}
	c.mu.Lock()
	if !c.enabled || c.Status == contract.ComponentStatusCrashLoop {
		c.mu.Unlock()
		return
	}
	// 读取依赖关系后即释放 c.mu，避免持 c.mu 时调用 s.Get（需 s.mu），
	// 与 Snapshot（持 s.mu 再取 c.mu）构成 AB-BA 锁序倒置死锁（定向复审补充修复）。
	dependsOn := c.dependsOn
	c.mu.Unlock()

	// 编排：依赖组件未 running 时阻塞（collector 等 blackbox）。依赖组件经 s.Get
	// （内部持 s.mu）读取并锁 dep.mu，避免与 getOrCreate / Reconcile 并发写 s.comps
	// 构成 data race（H-1 修复：裸 map 读可触发 fatal concurrent map read and write）。
	if dependsOn != "" {
		dep := s.Get(dependsOn)
		if dep != nil {
			dep.mu.Lock()
			depReady := dep.enabled && dep.Status == contract.ComponentStatusRunning
			dep.mu.Unlock()
			if !depReady {
				return
			}
		}
	}

	alive := s.probe.Alive(c)
	healthy := alive && s.probe.Healthy(c)
	now := s.clock()

	c.mu.Lock()
	if alive && healthy {
		// 稳态：清退退避与熔断窗口。
		c.Status = contract.ComponentStatusRunning
		c.restartTimes = pruneRestarts(c.restartTimes, now, s.params.BreakerWindow)
		c.backoff = s.params.BackoffMin
		c.LastError = ""
		c.mu.Unlock()
		return
	}

	// 双判定任一异常 → 记重启，指数退避，尝试拉起。
	c.RestartCount++
	c.LastRestartAt = now.UTC().Format(time.RFC3339)
	c.restartTimes = append(pruneRestarts(c.restartTimes, now, s.params.BreakerWindow), now)
	if len(c.restartTimes) >= s.params.BreakerThreshold {
		c.Status = contract.ComponentStatusCrashLoop
		c.LastError = "crash loop detected (>= threshold restarts within window)"
		c.mu.Unlock()
		return
	}
	c.Status = contract.ComponentStatusRestarting
	c.LastError = func() string {
		if !alive {
			return "进程不存活 (probe.Alive=false)"
		}
		return "进程存活但健康检查失败 (probe.Healthy=false)"
	}()
	backoff := c.backoff
	c.backoff = minDur(c.backoff*2, s.params.BackoffMax)
	c.mu.Unlock()

	if s.sleep != nil {
		s.sleep(ctx, backoff)
	}
	if err := s.probe.Start(c); err != nil {
		c.mu.Lock()
		c.RestartCount++
		c.LastError = "start failed: " + err.Error()
		c.mu.Unlock()
		return
	}
	c.mu.Lock()
	c.Status = contract.ComponentStatusRunning
	c.LastError = ""
	c.mu.Unlock()
}

// pruneRestarts 去掉窗口外（早于 now-window）的重启时刻。
func pruneRestarts(ts []time.Time, now time.Time, window time.Duration) []time.Time {
	cutoff := now.Add(-window)
	out := make([]time.Time, 0, len(ts))
	for _, t := range ts {
		if !t.Before(cutoff) {
			out = append(out, t)
		}
	}
	return out
}

// minDur 返回两个时长中较小者。
func minDur(a, b time.Duration) time.Duration {
	if a < b {
		return a
	}
	return b
}
