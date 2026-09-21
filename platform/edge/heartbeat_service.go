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
	// Targets 是边缘 vmagent 本地 target 抓取快照（方案 B，随心跳上报），字段与
	// agent 侧 contract.EdgeTargetSnapshot 对齐。本轮仅透传占位，不做持久化。
	Targets []EdgeTargetSnapshot `json:"targets,omitempty"`
}

// EdgeTargetSnapshot 是边缘 vmagent 本地 target 抓取快照（方案 B），供中心后续
// 融合 /api/v1/targets 与「监控目标状态」页排障。字段对齐 agent 侧
// contract.EdgeTargetSnapshot（Module_11）。
type EdgeTargetSnapshot struct {
	Job                   string  `json:"job"`                                // 标签 job
	Instance              string  `json:"instance"`                           // 标签 instance（host:port）
	ResourceID            string  `json:"resource_id,omitempty"`              // prometheus.yml targets 注入标签，可能缺
	Health                string  `json:"health"`                             // up / down / unknown（透传字符串）
	LastScrape            string  `json:"last_scrape,omitempty"`              // 最近一次抓取时间（RFC3339）
	LastError             string  `json:"last_error,omitempty"`               // 最近抓取错误摘要
	ScrapeDurationSeconds float64 `json:"scrape_duration_seconds,omitempty"`  // 最近一次抓取耗时（秒）
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

	// 更新运行态。
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

	// 同步 config_sync_status / out_of_sync_cause（§8.1）。
	syncStatus := models.ConfigSyncStatusInSync
	var cause models.OutOfSyncCause
	fullUpdate := false
	if changed {
		syncStatus = models.ConfigSyncStatusOutOfSync
		cause = models.OutOfSyncCausePullPending
		fullUpdate = true
	}
	updates := map[string]interface{}{
		"config_sync_status": syncStatus,
	}
	if fullUpdate {
		updates["out_of_sync_cause"] = cause
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
