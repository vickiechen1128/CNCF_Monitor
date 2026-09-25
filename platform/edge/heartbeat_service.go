package edge

import (
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"

	"gorm.io/gorm"
)

// HeartbeatRequest 是 Agent 心跳上报请求体（PRD §6.2；components 见 §5.3）。
type HeartbeatRequest struct {
	NetworkDomainID      string                 `json:"network_domain_id"`
	AgentType            models.AgentType       `json:"agent_type"`
	Version              string                 `json:"version,omitempty"`
	ConfigVersion        string                 `json:"config_version,omitempty"`
	QueueBacklogBytes    int64                  `json:"queue_backlog_bytes,omitempty"`
	RemoteWriteQueueSize int                    `json:"remote_write_queue_size,omitempty"`
	RemoteWriteLastError string                 `json:"remote_write_last_error,omitempty"`
	Hostname             string                 `json:"hostname,omitempty"`
	Ip                   string                 `json:"ip,omitempty"`
	Components           []models.EdgeComponent `json:"components,omitempty"`
	// ConfigApplyError / ConfigApplyFailedVersion 是 Agent 上报的配置应用结果
	// （M11 设计提案 D-2）：Deployer.Apply 失败时携带失败原因与失败版本，中心据此把
	// out_of_sync 成因判为 apply_failed（「同步失败」）；应用成功时 Agent 不再上报
	// （omitempty），中心同步清空落库文本。
	ConfigApplyError         string `json:"config_apply_error,omitempty"`
	ConfigApplyFailedVersion string `json:"config_apply_failed_version,omitempty"`
	// Targets 是边缘 vmagent 本地 target 抓取快照（方案 B，随心跳上报），字段与
	// agent 侧 contract.EdgeTargetSnapshot 对齐。本轮仅透传占位，不做持久化。
	Targets []EdgeTargetSnapshot `json:"targets,omitempty"`
}

// EdgeTargetSnapshot 是边缘 vmagent 本地 target 抓取快照（方案 B），供中心后续
// 融合 /api/v1/targets 与「监控目标状态」页排障。字段对齐 agent 侧
// contract.EdgeTargetSnapshot（Module_11）。
type EdgeTargetSnapshot struct {
	Job                   string  `json:"job"`                               // 标签 job
	Instance              string  `json:"instance"`                          // 标签 instance（host:port）
	ResourceID            string  `json:"resource_id,omitempty"`             // prometheus.yml targets 注入标签，可能缺
	Health                string  `json:"health"`                            // up / down / unknown（透传字符串）
	LastScrape            string  `json:"last_scrape,omitempty"`             // 最近一次抓取时间（RFC3339）
	LastError             string  `json:"last_error,omitempty"`              // 最近抓取错误摘要
	ScrapeDurationSeconds float64 `json:"scrape_duration_seconds,omitempty"` // 最近一次抓取耗时（秒）
}

// HeartbeatResponse 是心跳响应体（PRD §6.2）。
type HeartbeatResponse struct {
	ConfigChanged     bool   `json:"config_changed"`
	ConfigVersion     string `json:"config_version"`
	ConfigDownloadURL string `json:"config_download_url"`
}

// HeartbeatService 处理边缘 Agent 心跳上报：自动注册缺失实例、以中心接收时间更新
// 运行态、并判定是否有新配置待拉取（config_changed）。
type HeartbeatService struct {
	db *gorm.DB
}

// NewHeartbeatService 构造 HeartbeatService。
func NewHeartbeatService(db *gorm.DB) *HeartbeatService { return &HeartbeatService{db: db} }

// Handle 执行心跳处理逻辑。authority 为中心对外绝对地址（scheme://host:port），
// 由 handler 从请求来源推导（见 requestAuthority），用于生成 config_download_url。
func (s *HeartbeatService) Handle(dom *models.NetworkDomain, req *HeartbeatRequest, now time.Time, authority string) (*HeartbeatResponse, error) {
	if req.NetworkDomainID == "" {
		req.NetworkDomainID = dom.ID
	}
	if req.NetworkDomainID != dom.ID {
		return nil, fmt.Errorf("heartbeat network_domain_id %q mismatch authorized domain %q", req.NetworkDomainID, dom.ID)
	}

	// 定位 EdgeAgent，无则自动注册（§3.2 采集节点自动注册）。
	agent, err := s.findOrRegisterAgent(dom, req, now)
	if err != nil {
		return nil, err
	}

	// 更新运行态。prevConfigVersion 先留存，供下方「拉取留痕」判定版本是否推进。
	prevConfigVersion := agent.ConfigVersion
	agent.LastHeartbeat = &now
	agent.Hostname = req.Hostname
	agent.Ip = req.Ip
	agent.Components = req.Components
	agent.QueueBacklogBytes = req.QueueBacklogBytes
	agent.ConfigVersion = req.ConfigVersion
	agent.Status = "online"
	if err := s.db.Save(agent).Error; err != nil {
		return nil, fmt.Errorf("save edge agent runtime state: %w", err)
	}

	// 观测留痕：写入 edge_heartbeats（§5.3）。
	hb := &models.EdgeHeartbeat{
		NetworkDomainID:      req.NetworkDomainID,
		AgentType:            req.AgentType,
		Version:              req.Version,
		ConfigVersion:        req.ConfigVersion,
		QueueBacklogBytes:    req.QueueBacklogBytes,
		RemoteWriteQueueSize: req.RemoteWriteQueueSize,
		RemoteWriteLastError: req.RemoteWriteLastError,
		Hostname:             req.Hostname,
		Ip:                   req.Ip,
		Components:           req.Components,
		Timestamp:            now,
	}
	if err := s.db.Create(hb).Error; err != nil {
		return nil, fmt.Errorf("record edge heartbeat: %w", err)
	}

	// F-11：落库边缘 vmagent target 快照（方案 B）。独立事务、失败降级，不阻断心跳主流程
	// （同 writebackAgentPullDeployments 解耦口径）。详见 persistEdgeTargetSnapshots。
	if err := s.persistEdgeTargetSnapshots(agent, req, now); err != nil {
		_ = err
	}

	// config_changed 判定：上报 config_version 与最新已确认 ConfigVersion 比对。
	latest, err := latestConfigVersion(s.db, req.NetworkDomainID)
	if err != nil {
		return nil, err
	}
	latestStr := ""
	if latest != nil {
		latestStr = configVersionString(latest)
	}
	changed := req.ConfigVersion != latestStr

	// 同步 config_sync_status / out_of_sync_cause（§8.1）。三态判定（M11 设计提案 D-2）：
	//   - 版本一致（应用成功）→ in_sync，清空成因与陈旧应用错误文本；
	//   - 版本不一致且 Agent 上报的失败版本 == 中心最新版本 → out_of_sync + apply_failed
	//     （已拉到最新但应用失败，已回滚至上一可用版本）；
	//   - 版本不一致且无（或非最新版本的）应用错误 → out_of_sync + pull_pending（F-16「同步中」）。
	// 失败版本 ≠ 最新（已有更新版本待拉取）时仍按 pull_pending，避免用陈旧错误覆盖真因。
	syncStatus := models.ConfigSyncStatusInSync
	var cause models.OutOfSyncCause
	if changed {
		syncStatus = models.ConfigSyncStatusOutOfSync
		cause = models.OutOfSyncCausePullPending
		if req.ConfigApplyError != "" && latest != nil && req.ConfigApplyFailedVersion == latestStr {
			cause = models.OutOfSyncCauseApplyFailed
		}
	}
	// 应用错误文本：以 Agent 上报为准镜像落库（空值即清空），保证「应用成功 → 清空」。
	updates := map[string]interface{}{
		"config_sync_status":          syncStatus,
		"out_of_sync_cause":           cause, // 空字符串即清空成因（in_sync 时）
		"config_apply_error":          req.ConfigApplyError,
		"config_apply_failed_version": req.ConfigApplyFailedVersion,
	}
	// 拉取留痕 last_config_pull（PRD §5.2「最后拉取配置」，以中心接收时间为准）：此前该字段
	// 全链路无写入方（model/DTO/前端类型齐备但恒空），使「同步中」缺少时限佐证——无法区分
	// 「刚下发、马上会拉」与「迟迟拉不到」。中心可观测的「发生过一次拉取」有两条线索：
	//   ① 上报版本推进到最新已确认版本（拉取并应用成功）；
	//   ② 上报「最新版本应用失败」（已拉包但应用失败并回滚，版本停留上一可用版本）。
	// 两者均以「事件首次出现」为界写入，避免同版本持续心跳把时间反复刷成「刚刚拉取」。
	pulledToLatest := !changed && latest != nil && req.ConfigVersion != prevConfigVersion
	applyFailedOnLatest := req.ConfigApplyError != "" && latest != nil &&
		req.ConfigApplyFailedVersion == latestStr &&
		agent.ConfigApplyFailedVersion != req.ConfigApplyFailedVersion
	if pulledToLatest || applyFailedOnLatest {
		updates["last_config_pull"] = now
	}
	if err := s.db.Model(&models.EdgeAgent{}).Where("id = ?", agent.ID).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("update config sync status: %w", err)
	}

	// M11 dev-feedback：agent 已与最新版本同步时，把该网域 agent_pull 通道待执行的
	// 下发记录回写成 success。此前 agent_pull 下发记录在 confirm 时仅登记 pending
	// 占位、无任何翻转为 success 的连接点，导致下发记录永久停留「待执行」。
	// 回写失败与心跳解耦，降级记录，不阻断心跳。
	if !changed && latest != nil {
		if err := writebackAgentPullDeployments(s.db, req.NetworkDomainID, latest, now); err != nil {
			// 降级：仅记心跳雷达备注，不返回错误，保证拉包闭环不被回写拖累。
			_ = err
		}
	}

	return &HeartbeatResponse{
		ConfigChanged:     changed,
		ConfigVersion:     latestStr,
		ConfigDownloadURL: configDownloadURL(authority, dom.ID),
	}, nil
}

// writebackAgentPullDeployments 将指定网域 agent_pull 通道下、对应目标版本的
// pending 下发记录改写为 success。agent_pull 通道 confirm 时只落 pending 占位
// （deployment.service.dispatchVersion），此处由心跳确认 agent 已与应用此版本后
// 补全「成功」状态，使「配置发布与回滚记录」口径与节点配置同步状态一致。
func writebackAgentPullDeployments(db *gorm.DB, domainID string, version *models.ConfigVersion, now time.Time) error {
	// 匹配点：deployment.ConfigVersionID 存 fmt.Sprint(version.ID)（int 主键）。
	targetID := fmt.Sprint(version.ID)
	res := db.Model(&models.ConfigDeployment{}).
		Where("network_domain_id = ? AND config_version_id = ? AND status = ?",
			domainID, targetID, models.DeploymentStatusPending).
		Updates(map[string]interface{}{
			"status":       models.DeploymentStatusSuccess,
			"completed_at": now,
		})
	if res.Error != nil {
		return fmt.Errorf("writeback agent_pull deployment to success: %w", res.Error)
	}
	return nil
}

// maxSnapshotsPerHeartbeat 单心跳最多落库的 target 快照数（F-11 子项①：心跳体积。
// MVP 全量上报 + 中心上限截断，超出的快照丢弃；v0.3 再评估分页/增量/压缩）。
const maxSnapshotsPerHeartbeat = 1000

// persistEdgeTargetSnapshots 将本轮心跳 targets 快照按 clear-then-insert 落库
// （F-11）：同一事务内硬删该 agent 上轮全部快照 → 批量插入本轮（同键覆盖更新，不无限
// 追加）。targets 为空时不清库也不插库——保留上轮快照：vmagent 拉取失败/未启动也会随
// 心跳上报空列表，误清会丢失「真实为空」与「获取失败」的分野。快照属高频瞬时状态、
// 无审计价值，故硬删（Unscoped）而非软删（软删会占用唯一索引，导致同键重插冲突）。
// 每行记录 LastReportAt（中心接收时间），供融合阶段判断「agent 离线后快照过期降级」。
func (s *HeartbeatService) persistEdgeTargetSnapshots(agent *models.EdgeAgent, req *HeartbeatRequest, now time.Time) error {
	if len(req.Targets) == 0 {
		return nil
	}
	// 去重键 (job, instance)（F-11 子项②，resource_id 为注入标签可能缺，不作去重键）
	// + 上限截断。
	seen := make(map[string]struct{}, len(req.Targets))
	rows := make([]models.EdgeTargetSnapshot, 0, min(len(req.Targets), maxSnapshotsPerHeartbeat))
	for _, t := range req.Targets {
		if len(rows) >= maxSnapshotsPerHeartbeat {
			break
		}
		key := t.Job + "\x00" + t.Instance
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		rows = append(rows, models.EdgeTargetSnapshot{
			NetworkDomainID:       req.NetworkDomainID,
			EdgeAgentID:           agent.ID,
			Job:                   t.Job,
			Instance:              t.Instance,
			ResourceID:            t.ResourceID,
			Health:                t.Health,
			LastScrape:            t.LastScrape,
			LastError:             t.LastError,
			ScrapeDurationSeconds: t.ScrapeDurationSeconds,
			LastReportAt:          now,
		})
	}
	if len(rows) == 0 {
		return nil
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		// 清理上一份快照（按 edge_agent_id 维度，而非仅网域）。
		if err := tx.Unscoped().Where("edge_agent_id = ? AND network_domain_id = ?",
			agent.ID, req.NetworkDomainID).Delete(&models.EdgeTargetSnapshot{}).Error; err != nil {
			return fmt.Errorf("clear previous edge target snapshots: %w", err)
		}
		if err := tx.Create(&rows).Error; err != nil {
			return fmt.Errorf("persist edge target snapshots: %w", err)
		}
		return nil
	})
}

// findOrRegisterAgent 返回网域对应的 EdgeAgent；不存在则按 §3.2 自动注册。
func (s *HeartbeatService) findOrRegisterAgent(dom *models.NetworkDomain, req *HeartbeatRequest, now time.Time) (*models.EdgeAgent, error) {
	var agent models.EdgeAgent
	err := s.db.Where("network_domain_id = ?", dom.ID).First(&agent).Error
	if err == nil {
		return &agent, nil
	}
	if !strings.Contains(err.Error(), "record not found") {
		return nil, fmt.Errorf("load edge agent for %s: %w", dom.ID, err)
	}

	agent = models.EdgeAgent{
		NetworkDomainID:  dom.ID,
		AgentType:        req.AgentType,
		Version:          req.Version,
		Hostname:         req.Hostname,
		Ip:               req.Ip,
		Status:           "online",
		LastHeartbeat:    &now,
		ConfigVersion:    req.ConfigVersion,
		ConfigSyncStatus: models.ConfigSyncStatusUnknown,
	}
	if agent.AgentType == "" {
		agent.AgentType = dom.AgentType
	}
	if err := s.db.Create(&agent).Error; err != nil {
		return nil, fmt.Errorf("auto-register edge agent for %s: %w", dom.ID, err)
	}
	return &agent, nil
}
