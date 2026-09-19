package edge

import (
	"context"
	"log"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"

	"gorm.io/gorm"
)

// 离线判定参数（PRD §4.2：「心跳 + 1 次配置检查，相邻 ≥3 周期≈90s 失联判定离线」）。
const (
	// DefaultOfflineThreshold 默认离线阈值：3 心跳周期 * 30s = 90s。
	DefaultOfflineThreshold = 90 * time.Second
	// DefaultOfflineInterval 默认探测器轮询间隔。
	DefaultOfflineInterval = 15 * time.Second
)

// AgentRuntimeStatus 是节点运行态取值（§3.2 聚合 + 离线探测）。
const (
	AgentStatusOnline  = "online"
	AgentStatusOffline = "offline"
	AgentStatusUnknown = "unknown"
	AgentStatusRetired = "retired"
	// AgentStatusPartial 仅用于节点展示三档（在线但必装组件异常），不落库；离线判定仍走 online/offline。
	AgentStatusPartial = "partial"
)

// DomainRuntimeStatus 是网域运行态聚合取值（§8.2 / §3.2）。
const (
	DomainRuntimeNormal  = "normal"  // 正常：节点全部在线
	DomainRuntimePartial = "partial" // 部分异常：在线/离线混合
	DomainRuntimeOffline = "offline" // 离线：全部节点失联
	DomainRuntimeUnknown = "unknown" // 无节点或状态未知
)

// SiteOfflineHook 是网域整体离线事件钩子（D4：只暴露状态与事件，不接 M08 规则）。
// 返回 error 仅用于记录；探测器不以它决定状态推进。
type SiteOfflineHook func(domainID string) error

// OfflineDetector 后台离线探测器：轮询 EdgeAgent.last_heartbeat，超过阈值置 offline；
// 恢复心跳自动回 online；网域内全部节点离线时聚合网域运行态并触发 SiteOfflineHook。
type OfflineDetector struct {
	db        *gorm.DB
	threshold time.Duration
	interval  time.Duration
	onOffline SiteOfflineHook
}

// NewOfflineDetector 构造探测器；threshold/interval<=0 时用默认值。
func NewOfflineDetector(db *gorm.DB, threshold, interval time.Duration, hook SiteOfflineHook) *OfflineDetector {
	if threshold <= 0 {
		threshold = DefaultOfflineThreshold
	}
	if interval <= 0 {
		interval = DefaultOfflineInterval
	}
	return &OfflineDetector{db: db, threshold: threshold, interval: interval, onOffline: hook}
}

// Run 在独立 goroutine 中启动轮询，随 ctx 优雅退出；首个 tick 等待一个 interval。
func (d *OfflineDetector) Run(ctx context.Context) {
	if d.db == nil {
		log.Printf("[offline-detect] db is nil, detector disabled")
		return
	}
	ticker := time.NewTicker(d.interval)
	defer ticker.Stop()
	log.Printf("[offline-detect] started threshold=%s interval=%s", d.threshold, d.interval)
	select {
	case <-ctx.Done():
		log.Printf("[offline-detect] stopped before first pass")
		return
	case <-ticker.C:
	}
	for {
		_, _ = DetectOffline(d.db, d.threshold, time.Now().UTC(), d.onOffline)
		select {
		case <-ctx.Done():
			log.Printf("[offline-detect] stopped")
			return
		case <-ticker.C:
		}
	}
}

// StartOfflineDetector 便捷入口：构造并在后台启动。
func StartOfflineDetector(ctx context.Context, db *gorm.DB, threshold, interval time.Duration, hook SiteOfflineHook) *OfflineDetector {
	d := NewOfflineDetector(db, threshold, interval, hook)
	go d.Run(ctx)
	return d
}

// DetectOffline 执行一轮离线探测（线程安全由调用方保证；测试可直接调用）。
// 流程：
//  1. 扫描全部 EdgeAgent，按 last_heartbeat 是否超过阈值置 online/offline（retired 保持）；
//  2. 聚合 agent_pull 已纳管网域的运行态（MonitoredStatus）；
//  3. 网域由非 offline 转 offline 时触发 SiteOfflineHook（D4）。
//
// 返回转为「网域离线」的网域 id 列表。
func DetectOffline(db *gorm.DB, threshold time.Duration, now time.Time, hook SiteOfflineHook) ([]string, error) {
	if threshold <= 0 {
		threshold = DefaultOfflineThreshold
	}

	var agents []models.EdgeAgent
	if err := db.Find(&agents).Error; err != nil {
		return nil, err
	}
	// 按网域聚合节点状态。
	byDomain := map[string][]*models.EdgeAgent{}
	for i := range agents {
		a := &agents[i]
		st := agentLiveStatus(a, now, threshold)
		if a.Status != st {
			if err := db.Model(a).Update("status", st).Error; err != nil {
				return nil, err
			}
			a.Status = st
		}
		byDomain[a.NetworkDomainID] = append(byDomain[a.NetworkDomainID], a)
	}

	// 聚合网域运行态（仅 agent_pull 且未退纳管）。
	var domains []models.NetworkDomain
	if err := db.Where("channel = ? AND is_monitored = ? AND registration_status != ?",
		models.ChannelTypeAgentPull, true, models.RegistrationStatusRetired).Find(&domains).Error; err != nil {
		return nil, err
	}

	var offlineDomains []string
	for _, d := range domains {
		runtime := aggregateDomainStatus(byDomain[d.ID])
		prev := d.MonitoredStatus
		if d.MonitoredStatus != runtime {
			if err := db.Model(&d).Update("monitored_status", runtime).Error; err != nil {
				return nil, err
			}
			d.MonitoredStatus = runtime
		}
		if runtime == DomainRuntimeOffline && prev != DomainRuntimeOffline && hook != nil {
			if err := hook(d.ID); err != nil {
				log.Printf("[offline-detect] site offline hook error domain=%s: %v", d.ID, err)
			}
			offlineDomains = append(offlineDomains, d.ID)
		}
	}
	return offlineDomains, nil
}

// agentLiveStatus 计算节点展示运行态（不落库的读取视角）。
func agentLiveStatus(a *models.EdgeAgent, now time.Time, threshold time.Duration) string {
	if a.Status == AgentStatusRetired {
		return AgentStatusRetired
	}
	if a.LastHeartbeat == nil || now.Sub(*a.LastHeartbeat) > threshold {
		return AgentStatusOffline
	}
	return AgentStatusOnline
}

// aggregateDomainStatus 按节点运行态聚合网域三档（normal/partial/offline/unknown）。
func aggregateDomainStatus(agents []*models.EdgeAgent) string {
	online, offline := 0, 0
	for _, a := range agents {
		switch a.Status {
		case AgentStatusOnline:
			online++
		case AgentStatusOffline:
			offline++
		case AgentStatusRetired:
			// retired 不计入运行态聚合
		default:
			offline++
		}
	}
	if len(agents) == 0 || (online+offline) == 0 {
		return DomainRuntimeUnknown
	}
	if online == 0 {
		return DomainRuntimeOffline
	}
	if offline == 0 {
		return DomainRuntimeNormal
	}
	return DomainRuntimePartial
}
