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
	WalBacklogBytes      int64                  `json:"wal_backlog_bytes,omitempty"`
	RemoteWriteQueueSize int                    `json:"remote_write_queue_size,omitempty"`
	RemoteWriteLastError string                 `json:"remote_write_last_error,omitempty"`
	Hostname             string                 `json:"hostname,omitempty"`
	Ip                   string                 `json:"ip,omitempty"`
	Components           []models.EdgeComponent `json:"components,omitempty"`
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

// Handle 执行心跳处理逻辑。
func (s *HeartbeatService) Handle(dom *models.NetworkDomain, req *HeartbeatRequest, now time.Time) (*HeartbeatResponse, error) {
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
	agent.WalBacklogBytes = req.WalBacklogBytes
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
		WalBacklogBytes:      req.WalBacklogBytes,
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

	return &HeartbeatResponse{
		ConfigChanged:     changed,
		ConfigVersion:     latestStr,
		ConfigDownloadURL: configDownloadURL(dom),
	}, nil
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
