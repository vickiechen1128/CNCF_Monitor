package supervisor

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
)

// fakeProbe 可编排的假探针：控制各组件存活/健康，记录 Start 顺序，支持指定次数的
// 首次 Start 失败（用于编排/退避测试）。
type fakeProbe struct {
	mu           sync.Mutex
	alive        map[string]bool
	healthy      map[string]bool
	starts       []string
	startFails   map[string]int
	healthyCalls map[string]int
}

func newFakeProbe() *fakeProbe {
	return &fakeProbe{
		alive:        map[string]bool{},
		healthy:      map[string]bool{},
		startFails:   map[string]int{},
		healthyCalls: map[string]int{},
	}
}
func (f *fakeProbe) Alive(c *Component) bool { f.mu.Lock(); defer f.mu.Unlock(); return f.alive[c.Type] }
func (f *fakeProbe) Healthy(c *Component) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.healthyCalls[c.Type]++
	return f.healthy[c.Type]
}
func (f *fakeProbe) Start(c *Component) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.starts = append(f.starts, c.Type)
	if f.startFails[c.Type] > 0 {
		f.startFails[c.Type]--
		return fmt.Errorf("injected start failure")
	}
	f.alive[c.Type] = true
	f.healthy[c.Type] = true
	return nil
}
func (f *fakeProbe) Stop(c *Component) error { return nil }
func (f *fakeProbe) CountStart(typ string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, s := range f.starts {
		if s == typ {
			n++
		}
	}
	return n
}
func (f *fakeProbe) ListStarts() []string { f.mu.Lock(); defer f.mu.Unlock(); s := append([]string(nil), f.starts...); return s }

func newTestSupervisor(t *testing.T, probe Probe) (*Supervisor, func() time.Time, *time.Time) {
	t.Helper()
	p := DefaultParams()
	sv := NewSupervisor(p, probe, logger.New(nil))
	t0 := time.Unix(1700000000, 0)
	tm := &t0
	sv.SetInject(func() time.Time { return *tm }, func(_ context.Context, _ time.Duration) {})
	return sv, func() time.Time { return *tm }, tm
}

// TestDualJudgmentProcessDeathGate：进程不存活时不作健康检查（healthy 短路），并触发重启。
func TestDualJudgmentProcessDeathGate(t *testing.T) {
	f := newFakeProbe()
	f.alive["agent"] = false
	f.healthy["agent"] = true
	sv, _, _ := newTestSupervisor(t, f)
	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeAgent, Name: "agent", Version: "v1"}})

	sv.StepOnce(context.Background())
	c := sv.Get(contract.ComponentTypeAgent)
	// 进程不存活 → 单 tick 内启动成功 → running，且健康检查未被执行。
	if c.Status != contract.ComponentStatusRunning {
		t.Fatalf("status = %s want running", c.Status)
	}
	if c.RestartCount != 1 {
		t.Fatalf("restart_count = %d want 1", c.RestartCount)
	}
	if f.healthyCalls[contract.ComponentTypeAgent] != 0 {
		t.Fatal("healthy should not be checked when process is not alive")
	}
}

// TestDualJudgmentAliveButUnhealthy：进程存活但健康检查失败 → 判定异常并重启，
// 持续失败保持 restarting、start failed 计入 restart_count。
func TestDualJudgmentAliveButUnhealthy(t *testing.T) {
	f := newFakeProbe()
	f.alive["collector"] = true
	f.healthy["collector"] = false
	f.startFails["collector"] = 1 // 首次 Start 失败 → 保持 restarting
	sv, _, _ := newTestSupervisor(t, f)
	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeCollector, Name: "vmagent", Version: "v1"}})

	sv.StepOnce(context.Background())
	c := sv.Get(contract.ComponentTypeCollector)
	if c.Status != contract.ComponentStatusRestarting {
		t.Fatalf("status = %s want restarting", c.Status)
	}
	if c.RestartCount != 2 {
		t.Fatalf("restart_count = %d want 2 (1 health-fail + 1 start-fail)", c.RestartCount)
	}
	if f.healthyCalls[contract.ComponentTypeCollector] < 1 {
		t.Fatal("healthy should be checked when process is alive")
	}
}

// TestBackoffAndBreakerEntersCrashLoop：连续快速失败（窗口内 ≥阈值次重启）进入 crash_loop。
func TestBackoffAndBreakerEntersCrashLoop(t *testing.T) {
	f := newFakeProbe()
	f.alive["agent"] = false
	f.healthy["agent"] = false
	f.startFails["agent"] = 999 // 永远失败
	sv, _, tm := newTestSupervisor(t, f)
	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeAgent, Name: "agent"}})

	ctx := context.Background()
	for i := 0; i < 6; i++ {
		sv.StepOnce(ctx)
		*tm = tm.Add(time.Second) // 全部落在 10min 窗口内
	}
	c := sv.Get(contract.ComponentTypeAgent)
	if c.Status != contract.ComponentStatusCrashLoop {
		t.Fatalf("status = %s want crash_loop (restart_count=%d)", c.Status, c.RestartCount)
	}
	if c.RestartCount < 5 {
		t.Fatalf("restart_count = %d want >=5", c.RestartCount)
	}
	// 熔断后不再自动重启。
	before := c.RestartCount
	sv.StepOnce(ctx)
	if c.RestartCount != before {
		t.Fatal("crash_loop should stop auto restarts")
	}
}

// TestOrchestrationBlackboxBeforeCollector：collector 依赖 blackbox；blackbox 未 running
// 时 collector 不被拉起，blackbox ready 后才拉起 collector。
func TestOrchestrationBlackboxBeforeCollector(t *testing.T) {
	f := newFakeProbe()
	f.alive[contract.ComponentTypeBlackbox] = false
	f.healthy[contract.ComponentTypeBlackbox] = true
	f.alive[contract.ComponentTypeCollector] = false
	f.healthy[contract.ComponentTypeCollector] = true
	f.startFails[contract.ComponentTypeBlackbox] = 1 // 首轮失败 → blackbox 仍 restarting

	sv, _, _ := newTestSupervisor(t, f)
	sv.Reconcile([]contract.Component{
		{Type: contract.ComponentTypeBlackbox, Name: "bb", Version: "v1"},
		{Type: contract.ComponentTypeCollector, Name: "vmagent", Version: "v1"},
	})

	ctx := context.Background()
	sv.StepOnce(ctx) // 首轮：blackbox 启动失败置 restarting，collector 被阻塞
	if starts := f.ListStarts(); len(starts) != 1 || starts[0] != contract.ComponentTypeBlackbox {
		t.Fatalf("first round starts = %v, collector must be blocked", starts)
	}
	if sv.Get(contract.ComponentTypeCollector).Status == contract.ComponentStatusRunning {
		t.Fatal("collector should not run before blackbox ready")
	}

	sv.StepOnce(ctx) // 次轮：blackbox 启动成功 → running，collector 才被拉起
	starts := f.ListStarts()
	if len(starts) != 3 || starts[2] != contract.ComponentTypeCollector {
		t.Fatalf("starts = %v want [blackbox blackbox collector]", starts)
	}
	if sv.Get(contract.ComponentTypeBlackbox).Status != contract.ComponentStatusRunning {
		t.Fatal("blackbox should be running")
	}
	if sv.Get(contract.ComponentTypeCollector).Status != contract.ComponentStatusRunning {
		t.Fatal("collector should be running after blackbox ready")
	}
}

// TestSnapshotReportsContractView：Snapshot 仅报启用组件，字段对齐 contract.Component。
func TestSnapshotReportsContractView(t *testing.T) {
	f := newFakeProbe()
	f.alive["collector"] = true
	f.healthy["collector"] = true
	sv, _, _ := newTestSupervisor(t, f)
	sv.Reconcile([]contract.Component{{Type: contract.ComponentTypeCollector, Name: "vmagent", Version: "v0.2", ConfigVersion: "v9"}})
	sv.StepOnce(context.Background())

	snaps := sv.Snapshot()
	if len(snaps) != 1 {
		t.Fatalf("snapshot len = %d want 1", len(snaps))
	}
	s := snaps[0]
	if s.Type != contract.ComponentTypeCollector || s.Status != contract.ComponentStatusRunning {
		t.Fatalf("snapshot = %+v", s)
	}
	if s.Version != "v0.2" || s.ConfigVersion != "v9" {
		t.Fatalf("snapshot version fields = %+v", s)
	}
	if s.RestartCount != 0 {
		t.Fatalf("snapshot restart_count = %d (component started healthy)", s.RestartCount)
	}
}
