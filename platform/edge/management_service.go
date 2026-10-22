package edge

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"

	"gorm.io/gorm"
)

// 退纳管相关 sentinel 错误。
var (
	// ErrRetireNotFound 表示网域不存在（或已软删）。
	ErrRetireNotFound = errors.New("network domain not found")
	// ErrRetireNotMonitored 表示网域尚未纳管，无法退纳管。
	ErrRetireNotMonitored = errors.New("network domain is not monitored")
	// ErrRetireManagementDomain 表示管理域（default）不可退纳管。
	ErrRetireManagementDomain = errors.New("management domain cannot be retired")
	// ErrRetireAlreadyRetired 表示网域已处于 retired 终态。
	ErrRetireAlreadyRetired = errors.New("network domain already retired")
)

// RetireDomain 退纳管并级联清退（PRD §3.1 / §6.5 / §8.3，决策 D3）。
//   - 废止 token（清空）；
//   - 停止纳管口径（is_monitored=false，MonitoredStatus 清空）；
//   - 该网域全部 EdgeAgent 状态置 retired 终态；
//   - registration_status → retired。
//
// 管理域（default，DomainType=management）不可退纳管（返回 ErrRetireManagementDomain）。
func RetireDomain(db *gorm.DB, id string) (*models.NetworkDomain, error) {
	var dom models.NetworkDomain
	if err := db.Where("id = ?", id).First(&dom).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRetireNotFound
		}
		return nil, fmt.Errorf("load network domain %s: %w", id, err)
	}
	if dom.DomainType == models.DomainTypeManagement {
		return nil, ErrRetireManagementDomain
	}
	if dom.RegistrationStatus == models.RegistrationStatusRetired {
		return nil, ErrRetireAlreadyRetired
	}
	if !dom.IsMonitored {
		return nil, ErrRetireNotMonitored
	}

	// 级联：节点置 retired 终态。
	if err := db.Model(&models.EdgeAgent{}).
		Where("network_domain_id = ?", id).
		Update("status", AgentStatusRetired).Error; err != nil {
		return nil, fmt.Errorf("retire edge agents for %s: %w", id, err)
	}

	// 退纳管后节点不再心跳，其 target 快照不会再有新一轮上报来覆盖；主动清空，
	// 避免「监控目标状态」页继续展示已退纳管网域的旧目标。
	if err := db.Unscoped().
		Where("network_domain_id = ?", id).
		Delete(&models.EdgeTargetSnapshot{}).Error; err != nil {
		return nil, fmt.Errorf("clear edge target snapshots for %s: %w", id, err)
	}

	// 废止 token、停止纳管口径、registration_status → retired。
	updates := map[string]interface{}{
		"token":               "",
		"is_monitored":        false,
		"monitored_status":    "",
		"registration_status": models.RegistrationStatusRetired,
	}
	if err := db.Model(&dom).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("retire network domain %s: %w", id, err)
	}
	dom.Token = ""
	dom.IsMonitored = false
	dom.RegistrationStatus = models.RegistrationStatusRetired
	dom.TokenMaskedView = models.TokenMasked("")
	return &dom, nil
}

// AgentView 是 edge-agents 列表 / 详情的平铺 DTO（§3.2 / §5.2）。
type AgentView struct {
	ID               uint                    `json:"id"`
	NetworkDomainID  string                  `json:"network_domain_id"`
	Hostname         string                  `json:"hostname"`
	Ip               string                  `json:"ip"`
	AgentType        models.AgentType        `json:"agent_type"`
	Version          string                  `json:"version"`
	Status           string                  `json:"status"` // online/offline/unknown/retired（存活视角，实时计算）
	LastHeartbeat    *string                 `json:"last_heartbeat,omitempty"`
	HeartbeatRTTMs   int                     `json:"heartbeat_rtt_ms,omitempty"`
	LastConfigPull   *string                 `json:"last_config_pull,omitempty"`
	ConfigVersion    string                  `json:"config_version,omitempty"`
	ConfigSyncStatus models.ConfigSyncStatus `json:"config_sync_status,omitempty"`
	OutOfSyncCause   models.OutOfSyncCause   `json:"out_of_sync_cause,omitempty"`
	// 配置应用失败诊断（M11 设计提案 D-2，字段与心跳契约同名同义）。
	ConfigApplyError         string `json:"config_apply_error,omitempty"`
	ConfigApplyFailedVersion string `json:"config_apply_failed_version,omitempty"`
	QueueBacklogBytes        int64  `json:"queue_backlog_bytes,omitempty"`
	// RemoteWriteDroppedTotal / RemoteWriteRetriesTotal 是 vmagent remote_write 累计
	// 丢块+丢包总数 / 累计重试次数（F-39）。丢块非零即数据丢失，须醒目展示；离线时同样
	// 保留透出（累计事实不随心跳超时失效，便于排障）。
	RemoteWriteDroppedTotal int64  `json:"remote_write_dropped_total,omitempty"`
	RemoteWriteRetriesTotal int64  `json:"remote_write_retries_total,omitempty"`
	RemoteWriteLastError    string `json:"remote_write_last_error,omitempty"`
	// RemoteWriteLagSeconds 是中心视角该网域 up 样本距今秒数的 p95 分位（F-40 口径
	// 延展：quantile by (network_domain_id) (0.95, time() - ts_of_last_over_time(up[24h]))）。
	// nil 表示无数据（24h 内无样本 / 中心 Prom 不可用 / 未配置查询器 / 中心 Prom 未开
	// promql-experimental-functions），与 0（新鲜）严格区分。
	RemoteWriteLagSeconds *int64 `json:"remote_write_lag_seconds,omitempty"`
	// BacklogAgeSeconds 是「积压数据龄」估算（F-40 延展①）：当前积压字节 ÷ 近期积压
	// 增速（相邻心跳差分），即按近期速率攒出当前积压所需时长。nil 表示无数据
	//（30min 窗口内心跳不足 / 积压未上涨 / 心跳过期），与 0 严格区分。网域级派生值，
	// 同域节点相同。
	BacklogAgeSeconds *int64 `json:"backlog_age_seconds,omitempty"`
	// BacklogGrowthBytesPerSec 是近期积压增速（字节/秒，负值表示积压在消化），
	// 对应「展示心跳中的积压增长趋势」口径（F-40 延展①）。
	BacklogGrowthBytesPerSec *int64 `json:"backlog_growth_bytes_per_sec,omitempty"`
	// ChannelStatus 是回传通道态（F-40 延展③，联动 F-39 指标）：abnormal 表示
	//「积压持续上涨 且 远端持续报错」——最新心跳 last_error 非空，且窗口内错误持续
	//（≥2 条心跳报错）或 retries 仍在增长。空/缺省 = 未见异常。
	ChannelStatus    string                 `json:"channel_status,omitempty"`
	CollectorStatus  string                 `json:"collector_status,omitempty"`
	CollectorVersion string                 `json:"collector_version,omitempty"`
	LastError        string                 `json:"last_error,omitempty"`
	Components       []models.EdgeComponent `json:"components,omitempty"` // 抽屉：restart_count / last_restart_at / status
	// MetadataRemoteWriteURL / MetadataMaxDiskUsagePerURL 是节点当前生效的回传参数
	//（F-42，Agent 心跳上报的 metadata 指纹镜像）：空 = 未下发，Agent 走内置兜底。
	MetadataRemoteWriteURL     string `json:"metadata_remote_write_url,omitempty"`
	MetadataMaxDiskUsagePerURL string `json:"metadata_max_disk_usage_per_url,omitempty"`
	// 人工滚动重启留痕（F-42 seq 简化机制）：指令位当前值 + 最近一次触发人/时间，
	// 供节点详情抽屉展示「最近一次人工重启」。
	VMAgentRestartSeq  int64   `json:"vm_agent_restart_seq,omitempty"`
	RestartRequestedBy string  `json:"restart_requested_by,omitempty"`
	RestartRequestedAt *string `json:"restart_requested_at,omitempty"`
	// 清空回传积压留痕（F-43，机制同上）：指令位当前值 + 最近一次触发人/时间。
	FlushBacklogSeq  int64   `json:"flush_backlog_seq,omitempty"`
	FlushRequestedBy string  `json:"flush_requested_by,omitempty"`
	FlushRequestedAt *string `json:"flush_requested_at,omitempty"`
}

func agentView(a *models.EdgeAgent, now time.Time, threshold time.Duration) AgentView {
	live := agentLiveStatus(a, now, threshold)
	v := AgentView{
		ID:               a.ID,
		NetworkDomainID:  a.NetworkDomainID,
		Hostname:         a.Hostname,
		Ip:               a.Ip,
		AgentType:        a.AgentType,
		Version:          a.Version,
		Status:           agentViewStatus(a, now, threshold, live),
		HeartbeatRTTMs:   a.HeartbeatRTTMs,
		ConfigVersion:    a.ConfigVersion,
		ConfigSyncStatus: a.ConfigSyncStatus,
		OutOfSyncCause:   a.OutOfSyncCause,
		// 配置应用失败诊断（D-2）：与 out_of_sync_cause 同口径透出，不做离线降级。
		ConfigApplyError:         a.ConfigApplyError,
		ConfigApplyFailedVersion: a.ConfigApplyFailedVersion,
		QueueBacklogBytes:        a.QueueBacklogBytes,
		RemoteWriteDroppedTotal:  a.RemoteWriteDroppedTotal,
		RemoteWriteRetriesTotal:  a.RemoteWriteRetriesTotal,
		RemoteWriteLastError:     a.RemoteWriteLastError,
		CollectorStatus:          a.CollectorStatus,
		CollectorVersion:         a.CollectorVersion,
		LastError:                a.LastError,
		Components:               a.Components,
		// F-42：生效回传参数与人工重启留痕透出（不做离线降级——生效参数与指令位是
		// 已发生的事实，离线后仍可用于排障）。
		MetadataRemoteWriteURL:     a.MetadataRemoteWriteURL,
		MetadataMaxDiskUsagePerURL: a.MetadataMaxDiskUsagePerURL,
		VMAgentRestartSeq:          a.VMAgentRestartSeq,
		RestartRequestedBy:         a.RestartRequestedBy,
		FlushBacklogSeq:            a.FlushBacklogSeq,
		FlushRequestedBy:           a.FlushRequestedBy,
	}
	if a.RestartRequestedAt != nil {
		s := a.RestartRequestedAt.UTC().Format(time.RFC3339)
		v.RestartRequestedAt = &s
	}
	if a.FlushRequestedAt != nil {
		s := a.FlushRequestedAt.UTC().Format(time.RFC3339)
		v.FlushRequestedAt = &s
	}
	// F-15 症状层：心跳超时（离线）或已退纳管（retired）时，节点已失去可信的实时状态，展示层统一降级：
	//   - 组件状态（CollectorStatus / Components[].status）覆写为 unknown——retired 节点可能残留孤儿
	//     进程仍在上报「运行中」，与「已退纳」并排展示即历史 F-15 的同一类认知冲突；
	//   - 失效「同步中」进行时成因：pull_pending 是带时限的断言（「等 Agent 下次心跳拉取，准实时
	//     ≤30s」），此刻已不可能再推进；而该成因只在心跳到来时才被重写（heartbeat_service），不处理
	//     会永久停留「同步中」假象。清空成因 → 前端回落「未同步」，且不再给出误导性的「查看下发」引导。
	// 复用离线判定口径（agentLiveStatus + 传入的 offlineThreshold，勿另起常量）；只改展示结果、
	// 不改 DB 原始上报值——agent 恢复心跳后自然回真实值。
	// 仅失效进行时成因：apply_failed 是已发生的终态事实，离线/退纳管后仍透出以便排障。
	if live == AgentStatusOffline || live == AgentStatusRetired {
		v.CollectorStatus = AgentStatusUnknown
		v.Components = degradeComponentsToUnknown(a.Components)
		if v.OutOfSyncCause == models.OutOfSyncCausePullPending {
			v.OutOfSyncCause = ""
		}
	}
	if a.LastHeartbeat != nil {
		s := a.LastHeartbeat.UTC().Format(time.RFC3339)
		v.LastHeartbeat = &s
	}
	if a.LastConfigPull != nil {
		s := a.LastConfigPull.UTC().Format(time.RFC3339)
		v.LastConfigPull = &s
	}
	return v
}

// componentStatusUnknown 是展示层派生值（F-15）：心跳过期降级时把组件 status 覆写为
// unknown。前端 componentStatusLabel 已含该档（展示「未知」）；本值不落库、不属于上报
// 契约枚举（models.ComponentStatus 只含 running/restarting/crash_loop/not_deployed）。
const componentStatusUnknown models.ComponentStatus = "unknown"

// degradeComponentsToUnknown 返回组件清单的展示副本，把各组件 status 覆写为 unknown；
// 不改动入参（DB 原始上报值），无组件时返回 nil 以保持 omitempty 语义。
func degradeComponentsToUnknown(comps []models.EdgeComponent) []models.EdgeComponent {
	if len(comps) == 0 {
		return nil
	}
	out := make([]models.EdgeComponent, len(comps))
	copy(out, comps)
	for i := range out {
		out[i].Status = componentStatusUnknown
	}
	return out
}

// agentViewStatus 计算节点展示三档「正常/部分异常/离线」（PRD §3.2）：
//   - 心跳超时 → 离线；retired 保持；
//   - 在线但必装组件（采集器）非 running → 部分异常；
//   - 否则 → 正常。
func agentViewStatus(a *models.EdgeAgent, now time.Time, threshold time.Duration, live string) string {
	if live == AgentStatusOffline || live == AgentStatusRetired {
		return live
	}
	for _, c := range a.Components {
		if c.Type == models.ComponentTypeCollector && c.Status != models.ComponentStatusRunning {
			return AgentStatusPartial
		}
	}
	return AgentStatusOnline
}

// AgentsSummary 是列表整体聚合（§3.2 三档）。
type AgentsSummary struct {
	Total   int `json:"total"`
	Online  int `json:"online"`
	Partial int `json:"partial"`
	Offline int `json:"offline"`
}

// EdgeAgentsResponse 是 GET /edge-agents 响应体。
type EdgeAgentsResponse struct {
	Overall string        `json:"overall"` // normal/partial/offline/unknown
	Summary AgentsSummary `json:"summary"`
	Agents  []AgentView   `json:"agents"`
}

// ListAgents 汇总全部 edge-agents；overall 按非 retired 节点实时状态聚合。
func ListAgents(db *gorm.DB, now time.Time, threshold time.Duration) (*EdgeAgentsResponse, error) {
	var agents []models.EdgeAgent
	if err := db.Find(&agents).Error; err != nil {
		return nil, fmt.Errorf("list edge agents: %w", err)
	}
	threshold = normThreshold(threshold)

	views := make([]AgentView, 0, len(agents))
	online, partial, offline := 0, 0, 0
	active := 0
	for i := range agents {
		a := &agents[i]
		v := agentView(a, now, threshold)
		if a.Status != AgentStatusRetired {
			active++
			switch v.Status {
			case AgentStatusOnline:
				online++
			case AgentStatusPartial:
				partial++
			default:
				offline++
			}
		}
		views = append(views, v)
	}

	overall := DomainRuntimeUnknown
	if active > 0 {
		switch {
		case offline == 0 && partial == 0:
			overall = DomainRuntimeNormal
		case online == 0:
			overall = DomainRuntimeOffline
		default:
			overall = DomainRuntimePartial
		}
	}

	return &EdgeAgentsResponse{
		Overall: overall,
		Summary: AgentsSummary{Total: active, Online: online, Partial: partial, Offline: offline},
		Agents:  views,
	}, nil
}

// GetAgent 返回单个 edge-agent 详情（含组件清单）；不存在返回 ErrRetireNotFound 同源的 not_found。
func GetAgent(db *gorm.DB, id uint, now time.Time, threshold time.Duration) (*AgentView, error) {
	var a models.EdgeAgent
	if err := db.First(&a, id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrRetireNotFound
		}
		return nil, fmt.Errorf("load edge agent %d: %w", id, err)
	}
	v := agentView(&a, now, normThreshold(threshold))
	return &v, nil
}

func normThreshold(t time.Duration) time.Duration {
	if t <= 0 {
		return DefaultOfflineThreshold
	}
	return t
}

// fillSampleLags 把网域级「中心视角样本滞后秒数」就地写入各 AgentView（F-40 延展）。
// lag 富化是显式组合步骤而非 ListAgents 内置逻辑：querier 为 nil（未接线/单测）或查询
// 失败（中心 Prom 不可用）时整体跳过，视图保持 nil（前端显示「无数据」），不阻塞列表。
// 一个网域可有多个采集节点，remote_write 走同一网域通道，网域级 max 滞后对同域节点相同。
func fillSampleLags(views []AgentView, q SampleLagQuerier) {
	if q == nil || len(views) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	lags, err := q.QueryDomainLags(ctx)
	if err != nil {
		return // 降级为无数据：观测增强不应拖垮节点列表
	}
	for i := range views {
		if secs, ok := lags[views[i].NetworkDomainID]; ok {
			v := secs
			views[i].RemoteWriteLagSeconds = &v
		}
	}
}

// 回传通道洞察（F-40 延展①③）：从 edge_heartbeats 相邻心跳差分估算积压增速与
// 「积压数据龄」，并联动 F-39 的 remote_write_last_error / remote_write_retries_total
// 判定通道异常态——回应「回传延迟显示『刚刚』但积压持续上涨」的口径盲区：延迟 p95
// 只看样本时间戳，看不出积压在攒；数据龄与通道态把「积压还要涨多久」直接摆出来。
const (
	// backlogInsightLookback 是差分取样的回看窗口：窗口内无心跳即视为数据过期，
	// 字段保持缺省（离线节点不展示陈旧推算）。
	backlogInsightLookback = 30 * time.Minute
	// backlogInsightSamples 是单网域最多加载的心跳条数（30s 心跳 →约 5 分钟历史，
	// 足够覆盖增速差分与「持续错误」观察窗口）。
	backlogInsightSamples = 10
	// backlogInsightMinGap 是差分的最小时间间隔，避免同刻重复上报导致除零/速率失真。
	backlogInsightMinGap = 15 * time.Second
	// backlogInsightPersistWindow 是「持续错误」观察的心跳条数。
	backlogInsightPersistWindow = 3
)

// ChannelStatusAbnormal 是 AgentView.ChannelStatus 的异常档：积压持续上涨且远端
// 持续报错。空值（字段缺省）表示未见异常；后续如需加档（如 warning）再扩展。
const ChannelStatusAbnormal = "abnormal"

// fillBacklogInsights 就地写入积压数据龄 / 增速 / 通道异常态（F-40 延展①③）。
// 与 fillSampleLags 同为显式组合步骤：db 为 nil、查询失败或窗口内无心跳时保持缺省
// （前端显示「-」），不阻塞节点列表。
func fillBacklogInsights(db *gorm.DB, views []AgentView, now time.Time) {
	if db == nil || len(views) == 0 {
		return
	}
	seen := make(map[string]struct{}, len(views))
	for i := range views {
		dom := views[i].NetworkDomainID
		if _, ok := seen[dom]; ok {
			continue
		}
		seen[dom] = struct{}{}
		var hbs []models.EdgeHeartbeat
		err := db.Where("network_domain_id = ? AND timestamp >= ?", dom, now.Add(-backlogInsightLookback)).
			Order("timestamp DESC").Limit(backlogInsightSamples).Find(&hbs).Error
		if err != nil || len(hbs) == 0 {
			continue
		}
		age, growth, channel := backlogInsight(hbs)
		for j := range views {
			if views[j].NetworkDomainID != dom {
				continue
			}
			if age != nil {
				v := *age
				views[j].BacklogAgeSeconds = &v
			}
			if growth != nil {
				v := *growth
				views[j].BacklogGrowthBytesPerSec = &v
			}
			views[j].ChannelStatus = channel
		}
	}
}

// backlogInsight 从一条网域的近期心跳（按 timestamp 倒序）推算数据龄、增速与通道态：
//   - 增速 = (最新积压 - 较早积压) ÷ 时间差，取第一条间隔 ≥ backlogInsightMinGap 的
//     心跳做差分；负值表示积压在消化。
//   - 数据龄 = 最新积压 ÷ 增速（仅增速 > 0 时有义），即按近期速率攒出当前积压的时长
//     ——「积压字节 ÷ 近期生产速率」的可测近似（增速≈生产-消费，消费停滞时即生产侧积压速率）。
//   - 通道异常态 = 积压上涨 且 最新心跳仍在报错（last_error 非空）且 错误持续
//     （窗口内 ≥2 条心跳报错）或窗口内 retries 仍在增长；单次瞬时错误不触发。
func backlogInsight(hbs []models.EdgeHeartbeat) (age, growth *int64, channel string) {
	if len(hbs) == 0 {
		return nil, nil, ""
	}
	h0 := hbs[0]
	for i := 1; i < len(hbs); i++ {
		gap := h0.Timestamp.Sub(hbs[i].Timestamp)
		if gap < backlogInsightMinGap {
			continue
		}
		rate := float64(h0.QueueBacklogBytes-hbs[i].QueueBacklogBytes) / gap.Seconds()
		g := int64(math.Round(rate))
		growth = &g
		if rate > 0 && h0.QueueBacklogBytes > 0 {
			a := int64(float64(h0.QueueBacklogBytes) / rate)
			age = &a
		}
		break
	}
	if growth == nil || *growth <= 0 || h0.RemoteWriteLastError == "" {
		return age, growth, channel
	}
	n := min(len(hbs), backlogInsightPersistWindow)
	errCount := 0
	for i := 0; i < n; i++ {
		if hbs[i].RemoteWriteLastError != "" {
			errCount++
		}
	}
	retriesDelta := h0.RemoteWriteRetriesTotal - hbs[n-1].RemoteWriteRetriesTotal
	if errCount >= 2 || retriesDelta > 0 {
		channel = ChannelStatusAbnormal
	}
	return age, growth, channel
}
