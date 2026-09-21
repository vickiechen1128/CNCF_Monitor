// Package contract 定义 Edge Sync Agent 与中心 edge 协议交互的纯数据契约。
//
// 字段名与 json tag 严格对齐中心侧接口（PRD Module_11 §6.2 / §6.3）与中心
// platform/edge 包，保证 Agent 编解码与中心握手对齐。本包零控制面依赖
// （不 import gin/gorm/platform/models），Agent 独立 module 可独立编译。
package contract

// 组件类型（对齐 PRD §6.2 示例 components.type 与中心 ComponentType）。
const (
	ComponentTypeAgent     = "agent"
	ComponentTypeCollector = "collector"
	ComponentTypeBlackbox  = "blackbox_exporter"
)

// 组件运行状态（对齐中心 edge_heartbeat ComponentStatus 枚举）。
const (
	ComponentStatusRunning     = "running"
	ComponentStatusRestarting  = "restarting"
	ComponentStatusCrashLoop   = "crash_loop"
	ComponentStatusNotDeployed = "not_deployed"
	ComponentStatusUnknown     = "unknown"
)

// EdgeTargetSnapshot 是边缘 vmagent 本地 target 抓取快照（方案 B：随心跳上报中心，
// 供中心 /api/v1/targets 与「监控目标状态」页排障）。字段对齐 vmagent
// /api/v1/targets?state=active 响应 activeTargets item（labels + 顶层抓取详情）。
type EdgeTargetSnapshot struct {
	Job                   string  `json:"job"`                               // 标签 job
	Instance              string  `json:"instance"`                          // 标签 instance（host:port）
	ResourceID            string  `json:"resource_id,omitempty"`             // prometheus.yml targets 注入标签，可能缺
	Health                string  `json:"health"`                            // up / down / unknown（透传字符串）
	LastScrape            string  `json:"last_scrape,omitempty"`             // 最近一次抓取时间（RFC3339）
	LastError             string  `json:"last_error,omitempty"`              // 最近抓取错误摘要
	ScrapeDurationSeconds float64 `json:"scrape_duration_seconds,omitempty"` // 最近一次抓取耗时（秒）
}

// Component 描述当前节点上一个守护组件的运行态。
type Component struct {
	Type          string `json:"type"`                      // agent / collector / blackbox_exporter
	Name          string `json:"name"`                      // 组件进程名
	Status        string `json:"status"`                    // running / restarting / ...
	Version       string `json:"version,omitempty"`         // 组件版本（版本差异提示数据来源，§6.2）
	ConfigVersion string `json:"config_version,omitempty"`  // 生效配置版本
	RestartCount  int    `json:"restart_count,omitempty"`   // 本轮累计重启次数
	LastRestartAt string `json:"last_restart_at,omitempty"` // 最近一次重启（RFC3339）
	LastError     string `json:"last_error,omitempty"`      // 最近错误摘要
}

// HeartbeatRequest 是 POST /api/v2/platform/edge/heartbeat 的请求体（PRD §6.2）。
type HeartbeatRequest struct {
	NetworkDomainID      string               `json:"network_domain_id"`
	AgentType            string               `json:"agent_type"`                    // 采集器统一为 vmagent（决策 C4）
	Version              string               `json:"version,omitempty"`             // Agent 版本
	ConfigVersion        string               `json:"config_version,omitempty"`      // 当前生效配置版本
	QueueBacklogBytes    int64                `json:"queue_backlog_bytes,omitempty"` // 磁盘持久发送队列积压字节数（决策 C5）
	RemoteWriteQueueSize int                  `json:"remote_write_queue_size,omitempty"`
	Hostname             string               `json:"hostname,omitempty"`
	Ip                   string               `json:"ip,omitempty"`
	Components           []Component          `json:"components,omitempty"`
	Targets              []EdgeTargetSnapshot `json:"targets,omitempty"` // 边缘 vmagent 本地 target 快照（方案 B）
}

// HeartbeatResponse 是心跳接口的响应体（PRD §6.2）。
type HeartbeatResponse struct {
	ConfigChanged     bool   `json:"config_changed"`
	ConfigVersion     string `json:"config_version"`
	ConfigDownloadURL string `json:"config_download_url"`
}

// Metadata 是配置包内 metadata.json 的内容（PRD §6.3），与中心 zipper.go 对齐：
// config_version / generated_at / agent_type / Checksum（联合 sha256，排除 metadata.json）。
type Metadata struct {
	ConfigVersion string `json:"config_version"`
	GeneratedAt   string `json:"generated_at"`
	AgentType     string `json:"agent_type"`
	Checksum      string `json:"checksum"`
	// RemoteWriteURL 是中心下发的网域 remote_write 上报地址（网域 RemoteWriteURL，
	// 仅在中心显式配置时才下发，omitempty）。Agent 优先采用它作为 vmagent
	// -remoteWrite.url（T11-G1-02 方案 B），避免真实部署回落到 127.0.0.1 环回。
	RemoteWriteURL string `json:"remote_write_url,omitempty"`
}

// 配置包 zip 内部条目名（PRD §6.3）。
const (
	ZipEntryPrometheus  = "prometheus.yml"
	ZipEntryRules       = "rules.yml"
	ZipEntryBlackbox    = "blackbox.yml"
	ZipEntryMetadata    = "metadata.json"
	ZipTargetsDirPrefix = "targets/"
)

// edge 协议路由（PRD §6.2 / §6.3）——由 Agent 拼接以 center_endpoint 为前缀合成绝对地址。
const (
	HeartbeatPath = "/api/v2/platform/edge/heartbeat"
	// ConfigPath 为固定相对路径；实际请求 URL 由中心在心跳响应中返回绝对 config_download_url。
	ConfigPath = "/api/v2/platform/edge/config"
)

// 心跳上报缺省 Agent 类型（MVP 采集器为 vmagent）。
const (
	DefaultAgentType = "vmagent"
)
