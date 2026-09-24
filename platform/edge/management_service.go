package edge

import (
	"errors"
	"fmt"
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
	ID                uint                    `json:"id"`
	NetworkDomainID   string                  `json:"network_domain_id"`
	Hostname          string                  `json:"hostname"`
	Ip                string                  `json:"ip"`
	AgentType         models.AgentType        `json:"agent_type"`
	Version           string                  `json:"version"`
	Status            string                  `json:"status"` // online/offline/unknown/retired（存活视角，实时计算）
	LastHeartbeat     *string                 `json:"last_heartbeat,omitempty"`
	HeartbeatRTTMs    int                     `json:"heartbeat_rtt_ms,omitempty"`
	LastConfigPull    *string                 `json:"last_config_pull,omitempty"`
	ConfigVersion     string                  `json:"config_version,omitempty"`
	ConfigSyncStatus  models.ConfigSyncStatus `json:"config_sync_status,omitempty"`
	OutOfSyncCause    models.OutOfSyncCause   `json:"out_of_sync_cause,omitempty"`
	QueueBacklogBytes int64                   `json:"queue_backlog_bytes,omitempty"`
	CollectorStatus   string                  `json:"collector_status,omitempty"`
	CollectorVersion  string                  `json:"collector_version,omitempty"`
	LastError         string                  `json:"last_error,omitempty"`
	Components        []models.EdgeComponent  `json:"components,omitempty"` // 抽屉：restart_count / last_restart_at / status
}

func agentView(a *models.EdgeAgent, now time.Time, threshold time.Duration) AgentView {
	live := agentLiveStatus(a, now, threshold)
	v := AgentView{
		ID:                a.ID,
		NetworkDomainID:   a.NetworkDomainID,
		Hostname:          a.Hostname,
		Ip:                a.Ip,
		AgentType:         a.AgentType,
		Version:           a.Version,
		Status:            agentViewStatus(a, now, threshold, live),
		HeartbeatRTTMs:    a.HeartbeatRTTMs,
		ConfigVersion:     a.ConfigVersion,
		ConfigSyncStatus:  a.ConfigSyncStatus,
		OutOfSyncCause:    a.OutOfSyncCause,
		QueueBacklogBytes: a.QueueBacklogBytes,
		CollectorStatus:   a.CollectorStatus,
		CollectorVersion:  a.CollectorVersion,
		LastError:         a.LastError,
		Components:        a.Components,
	}
	// F-15 症状层：心跳超时（离线）时，把展示用的组件状态覆写为 unknown。
	// 复用离线判定口径（agentLiveStatus + 传入的 offlineThreshold，勿另起常量）；
	// 只改展示结果、不改 DB 原始上报值——agent 恢复心跳后自然回真实值。
	if live == AgentStatusOffline {
		v.CollectorStatus = AgentStatusUnknown
		v.Components = degradeComponentsToUnknown(a.Components)
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
