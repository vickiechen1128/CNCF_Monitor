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
	// 配置应用结果（M11 dev-feedback F-17 / 设计提案 D）：Deployer.Apply 失败时上报失败原因
	// 与失败版本，中心据此写 out_of_sync 成因 apply_failed（「同步失败」）；应用成功时两者清空
	// （omitempty 不产出键），保证向后兼容。
	ConfigApplyError         string `json:"config_apply_error,omitempty"`          // 最近一次配置应用失败原因（成功时为空）
	ConfigApplyFailedVersion string `json:"config_apply_failed_version,omitempty"` // 应用失败的配置版本

	// RemoteWriteLastError 是本机 vmagent remote_write 最近一次失败原因（读 vmagent
	// /metrics 的 vmagent_remotewrite_errors_total / push_failures_total /
	// retries_count_total 推导；无失败时为空，omitempty 不产出键）。
	//
	// F-17 登记的「契约单向定义」缺口修复：中心 HeartbeatRequest 早已定义
	// remote_write_last_error 并落库 edge_heartbeats，但 Agent 侧此前从未定义/发送，
	// 导致该字段恒空——边缘 remote_write 失败时中心侧完全无感，只能靠外部探测猜测
	// （本次实测即如此：边缘 up 长期未落中心，中心无任何失败线索）。接通后，remote_write
	// 失败原因可随心跳直达中心，节点状态页/心跳记录可展示，F-17 的可观测性缺口闭合。
	//
	// 取值是**摘要**而非全量日志：仅在有失败时非空，形如
	// "remote_write_failed: vmagent_remotewrite_errors_total=3 …（vmagent /metrics）"。
	RemoteWriteLastError string `json:"remote_write_last_error,omitempty"`

	// RemoteWriteDroppedTotal 是本机 vmagent remote_write 的累计丢块+丢包总数（F-39，
	// 读 /metrics 的 vm_persistentqueue_blocks_dropped_total +
	// vmagent_remotewrite_packets_dropped_total 跨分片求和）。非零即发生过数据丢失；
	// 为 0 / 缺失时表示无丢失或指标不可读，向后兼容。
	RemoteWriteDroppedTotal int64 `json:"remote_write_dropped_total,omitempty"`
	// RemoteWriteRetriesTotal 是累计发送重试次数（F-39，读
	// vmagent_remotewrite_retries_count_total 跨分片求和）；中心可按相邻心跳增速判
	// 「回传链路不稳」。
	RemoteWriteRetriesTotal int64 `json:"remote_write_retries_total,omitempty"`

	// MetadataRemoteWriteURL / MetadataMaxDiskUsagePerURL 是当前生效配置目录
	// metadata.json 的回传参数指纹（F-42）：Agent 把落盘参数原样上报，中心与网域
	// 当前配置比对，不一致时在心跳响应返回 params_changed=true 强制拉包（网域参数
	// 变更不改配置版本号，仅靠 config_changed 不会触发拉包）。未拉过包 / 老 Agent
	// 不上报（omitempty 不产出键），中心对空指纹按「参数不一致」处理返回
	// params_changed=true，对老 Agent 无副作用（其忽略未知响应字段）。
	MetadataRemoteWriteURL     string `json:"metadata_remote_write_url,omitempty"`
	MetadataMaxDiskUsagePerURL string `json:"metadata_max_disk_usage_per_url,omitempty"`
}

// HeartbeatResponse 是心跳接口的响应体（PRD §6.2）。
type HeartbeatResponse struct {
	ConfigChanged     bool   `json:"config_changed"`
	ConfigVersion     string `json:"config_version"`
	ConfigDownloadURL string `json:"config_download_url"`
	// ParamsChanged 表示网域回传参数（remote_write_url / max_disk_usage_per_url）
	// 与 Agent 上报的 metadata 指纹不一致（F-42）。新 Agent 见 true 时即使
	// config_changed=false 也强制拉包以落盘新参数；老 Agent 忽略该未知字段，
	// 混合版本部署不会产生循环拉包。
	ParamsChanged bool `json:"params_changed"`
	// VMAgentRestartSeq 是中心侧已登记的人工重启指令序号（F-42）：中心每次受理
	// 「重启采集进程」请求时原子递增并留痕，Agent 发现响应序号大于本地已执行序号时
	// 幂等滚动重启 vmagent 采集子进程（仅采集进程，Agent 本体与持久队列不受影响），
	// 执行成功后本地持久化已执行序号；失败不落盘，下轮心跳自动重试。0/缺失表示无指令。
	VMAgentRestartSeq int64 `json:"vm_agent_restart_seq,omitempty"`
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
	// MaxDiskUsagePerURL 是中心下发的 vmagent 持久队列磁盘上限（F-42，网域级，
	// 仅在中心显式配置时下发，omitempty）。Agent 优先采用它作为
	// -remoteWrite.maxDiskUsagePerURL；老版本中心不携带该字段时 Agent 按
	// env > 硬兜底回落（向后兼容）。
	MaxDiskUsagePerURL string `json:"max_disk_usage_per_url,omitempty"`
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
