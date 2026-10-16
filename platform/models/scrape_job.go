package models

// JobType distinguishes a standard scrape job from a blackbox probe job.
type JobType string

// Job type constants.
const (
	JobTypeStandard JobType = "standard"
	JobTypeBlackbox JobType = "blackbox"
)

// AuthType represents the scrape authentication mode.
type AuthType string

// Auth type constants.
const (
	AuthTypeNone   AuthType = "none"
	AuthTypeBasic  AuthType = "basic"
	AuthTypeBearer AuthType = "bearer"
)

// ChangeStatus represents the M09 config-change writeback status.
type ChangeStatus string

// Change status constants.
const (
	ChangeStatusNone      ChangeStatus = "none"
	ChangeStatusPending   ChangeStatus = "pending"
	ChangeStatusConfirmed ChangeStatus = "confirmed"
	ChangeStatusDeployed  ChangeStatus = "deployed"
)

// MappingOverride records a scrape parameter field whose value the user
// manually overrode at job creation/update (Module_01 §5.4 mapping_overrides)：
// 「同步映射默认值」时跳过这些字段（保护手动覆盖结果）。
type MappingOverride struct {
	Field string `json:"field"` // 覆盖的参数字段名（scrape_interval / scrape_timeout / metrics_path / scheme / label_template_id）
	Value string `json:"value"` // 覆盖后的快照值
}

// InstanceSelectionMode selects how instances are chosen for a job.
type InstanceSelectionMode string

// Instance selection mode constants.
const (
	InstanceSelectionManual InstanceSelectionMode = "manual" // MVP
	InstanceSelectionFilter InstanceSelectionMode = "filter" // v0.3+
)

// 采集参数全局兜底默认值（F-28 层叠默认链末端）：Job → 默认采集配置（映射）
// → 采集器模板（仅 metrics_path/scheme）→ 本组常量。与 Prometheus 常用约定一致。
const (
	DefaultScrapeInterval = "15s"
	DefaultScrapeTimeout  = "10s"
	DefaultMetricsPath    = "/metrics"
	DefaultScheme         = "http"
)

// ValidPromDuration 校验 s 是否为 Prometheus/VMAgent 接受的 duration 字面量
//（^\d+(ms|s|m|h|d|w|y)$）。空串返回 false，「留空=继承」语义由调用方先行判断。
// 背景：裸数字（如 "180"）会被 promtool check config 拒绝（not a valid duration
// string: "180"），导致变更单卡校验失败无法下发（2026-10-12 诊断），须在保存入口拦截。
func ValidPromDuration(s string) bool {
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 || i == len(s) {
		return false // 无数字，或无单位（裸数字即后者）
	}
	switch s[i:] {
	case "ms", "s", "m", "h", "d", "w", "y":
		return true
	}
	return false
}

// ScrapeJob defines a Prometheus scrape job configuration, aligned with
// Module_01 §5.4. Legacy Phase-0 fields are retained for compatibility.
type ScrapeJob struct {
	BaseModel
	JobName               string                `gorm:"size:100;uniqueIndex" json:"job_name"`
	JobType               JobType               `gorm:"size:20;not null" json:"job_type"` // standard / blackbox
	ResourceType          ResourceType          `gorm:"size:20;not null" json:"resource_type"`
	MonitorType           string                `gorm:"size:64" json:"monitor_type"` // 细粒度监控对象类型（推导）
	ExporterTemplateID    string                `gorm:"size:64" json:"exporter_template_id,omitempty"`
	NetworkDomainID       string                `gorm:"size:64;not null;index" json:"network_domain_id"` // 必填且须已纳管
	InstanceSelectionMode InstanceSelectionMode `gorm:"size:20;not null" json:"instance_selection_mode"` // manual
	SelectedInstanceIDs   []string              `gorm:"serializer:json" json:"selected_instance_ids"`
	ScrapeInterval        string                `gorm:"size:20;not null" json:"scrape_interval"`
	ScrapeTimeout         string                `gorm:"size:20;not null" json:"scrape_timeout"`
	MetricsPath           string                `gorm:"size:200;not null" json:"metrics_path"`
	Scheme                string                `gorm:"size:20;not null" json:"scheme"`
	AuthType              AuthType              `gorm:"size:20;not null" json:"auth_type"`
	Username              string                `gorm:"size:200" json:"username,omitempty"` // auth_type=basic
	Password              string                `gorm:"size:2000" json:"-"`                 // auth_type=basic；仅存储不回显明文（决策31）
	Token                 string                `gorm:"size:2000" json:"-"`                 // auth_type=bearer；仅存储不回显明文（决策31）
	TLSSkipVerify         bool                  `json:"tls_skip_verify"`
	CAFile                string                `gorm:"size:500" json:"ca_file,omitempty"`
	LabelTemplateID       string                `gorm:"size:64" json:"label_template_id,omitempty"`
	FilterRules           string                `gorm:"type:text" json:"filter_rules"`
	BlackboxModule        string                `gorm:"size:100" json:"blackbox_module,omitempty"` // job_type=blackbox
	BlackboxTargets       []BlackboxTarget      `gorm:"serializer:json" json:"blackbox_targets"`   // job_type=blackbox 拨测目标
	// TargetField 是拨测（job_type=blackbox）的探测地址字段键，生成时取该字段的值作为
	// 探测目标（复用 models.GetResourceField）。仅 blackbox 使用。
	//
	// **由 ResourceType 推导、不接受客户端传值**（2026-10-16 口径收紧）：接口服务固定
	// api_url、应用服务固定 health_check_url，见 models.BlackboxTargetField。保存时由
	// validateJobRequest 覆盖写入，故本列只读不写；存量旧 Job 可能仍存着其它类别的字段键，
	// 生成侧按本列原值解析，不受影响。
	TargetField string `gorm:"size:64" json:"target_field,omitempty"` // job_type=blackbox 探测地址字段（由 resource_type 推导）
	MappingOverrides      []MappingOverride     `gorm:"serializer:json" json:"mapping_overrides"`  // 手动覆盖映射默认值的参数字段（同步映射默认值时跳过，F-03）
	DraftStatus           string                `gorm:"size:20;not null" json:"draft_status"`      // draft/ready
	ChangeStatus          ChangeStatus          `gorm:"size:20;not null" json:"change_status"`
	Enabled               bool                  `json:"enabled"`
}
