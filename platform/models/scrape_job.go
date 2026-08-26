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
	DraftStatus           string                `gorm:"size:20;not null" json:"draft_status"`      // draft/ready
	ChangeStatus          ChangeStatus          `gorm:"size:20;not null" json:"change_status"`
	Enabled               bool                  `json:"enabled"`
}
