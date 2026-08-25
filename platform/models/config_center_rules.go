// Package models 承载 MetricCenter 领域模型。
// 本文件集中定义 Module_09 网域与配置中心的枚举常量与 JSON 载体结构体
// （validation_status / config_sync_status / 变更对象 / 风险 / 受影响文件 /
// ConfigChangeItem / AffectedConfigFile / ConfigDraftMetadata）。
// 参见 docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
//   §5.4（metadata / change_items JSON 载体）、§8 状态机、§9.2 技术验收。
package models

import "strings"

// ValidationStatus 表示配置下发前的中心内容校验状态。
type ValidationStatus string

// Validation status 常量（仅 passed 可确认下发）。
const (
	ValidationStatusPassed   ValidationStatus = "passed"   // 可确认下发
	ValidationStatusFailed   ValidationStatus = "failed"   // 阻止确认（提供重校 / 废弃出口）
	ValidationStatusPending  ValidationStatus = "pending"  // 未校验或生成中
	ValidationStatusRejected ValidationStatus = "rejected" // 人工/策略拒绝
)

// ValidationCause 表示校验失败/待校验的归因（决策 45-3，MVP 落 user_config 判定）。
type ValidationCause string

// Validation cause 常量。
const (
	ValidationCauseUserConfig   ValidationCause = "user_config"   // 用户配置问题，可修复（展示「重新校验 + 前往修改」）
	ValidationCausePlatformFault ValidationCause = "platform_fault" // 平台技术故障，自动重试、用户不可见
)

// ValidationDetail 表示结构化校验失败定位（对齐原型 validation_details）。
type ValidationDetail struct {
	File    string `json:"file,omitempty"`    // 受影响的配置文件/目标文件
	Line    int    `json:"line,omitempty"`    // 行号（0 = 无行号信息）
	Message string `json:"message"`           // 具体错误说明
}

// ConfigSyncStatus 表示边缘 Agent 配置同步状态（v0.2，MVP 仅占位常量）。
type ConfigSyncStatus string

// Config sync status 常量（五档）。
const (
	ConfigSyncStatusInSync          ConfigSyncStatus = "in_sync"
	ConfigSyncStatusOutOfSync       ConfigSyncStatus = "out_of_sync"
	ConfigSyncStatusUnknown         ConfigSyncStatus = "unknown"
	ConfigSyncStatusManualOverride  ConfigSyncStatus = "manual_override"
	ConfigSyncStatusNoVersion       ConfigSyncStatus = "no_version"
)

// OutOfSyncCause 表示 out_of_sync 的成因（v0.2，MVP 仅占位常量）。
type OutOfSyncCause string

// Out-of-sync 成因常量。
const (
	OutOfSyncCausePendingDraft OutOfSyncCause = "pending_draft"
	OutOfSyncCausePullPending  OutOfSyncCause = "pull_pending"
	OutOfSyncCauseLocalReset   OutOfSyncCause = "local_reset"
)

// ChangeItemTarget 表示结构化变更清单中的变更对象（源数据对象枚举）。
type ChangeItemTarget string

// 变更对象常量（与 Module_01 采集 Job / 规则编辑及 Module_07 资源 / 标签模板功能对象对齐）。
const (
	ChangeItemTargetScrapeJob        ChangeItemTarget = "scrape_job"        // 采集 Job
	ChangeItemTargetTargetInstance   ChangeItemTarget = "target_instance"   // 采集目标（实例）
	ChangeItemTargetMonitoringRule   ChangeItemTarget = "monitoring_rule"   // 告警规则
	ChangeItemTargetProbeTarget      ChangeItemTarget = "probe_target"      // 拨测目标
	ChangeItemTargetLabelTemplate    ChangeItemTarget = "label_template"    // 标签模板
)

// ChangeItemType 表示变更类型。
type ChangeItemType string

// 变更类型常量。
const (
	ChangeItemTypeAdd    ChangeItemType = "add"
	ChangeItemTypeUpdate ChangeItemType = "update"
	ChangeItemTypeDelete ChangeItemType = "delete"
)

// Risk 表示变更风险等级。删除目标 / 告警规则变更 = high，新增目标 = low。
type Risk string

// risk 常量。
const (
	RiskLow  Risk = "low"
	RiskHigh Risk = "high"
)

// AffectedFile 表示受影响 / 涉及的配置文件。
type AffectedFile string

// 受影响配置文件常量。
const (
	AffectedFilePrometheus AffectedFile = "prometheus" // prometheus.yml
	AffectedFileTargets    AffectedFile = "targets"     // targets/*.json
	AffectedFileRules      AffectedFile = "rules"       // rules.yml
	AffectedFileBlackbox   AffectedFile = "blackbox"    // blackbox.yml
)

// ConfigChangeItem 是变更列表中的一条结构化变更项（PRD §3.4，契约 §4）。
//
//	ID            变更项自增标识
//	Type          变更类型 add/update/delete
//	Target        变更对象（采集 Job / 采集目标 / 告警规则 / 拨测目标 / 标签模板）
//	Description   人话变更说明
//	AffectedFiles 影响/涉及的配置文件
//	Risk          风险等级 low/high
type ConfigChangeItem struct {
	ID            string   `json:"id"`
	Type          string   `json:"type"`           // ChangeItemType
	Target        string   `json:"target"`         // ChangeItemTarget
	Description   string   `json:"description"`
	AffectedFiles []string `json:"affected_files"` // AffectedFile 列表
	Risk          string   `json:"risk"`           // Risk
}

// AffectedConfigFile 表达单个受影响配置文件的判定结果（结构体载体，保留扩展位）。
type AffectedConfigFile struct {
	Name  string `json:"name"`
	Risk  string `json:"risk,omitempty"`
}

// ConfigDraftMetadata 是 ConfigDraft / ConfigVersion metadata 的 JSON 载体
// （PRD §3.3.3，技术信息下沉折叠）。
type ConfigDraftMetadata struct {
	SourceDataVersion    string `json:"source_data_version"`               // 各源表 max(updated_at) 聚合
	TriggerSummary       string `json:"trigger_summary,omitempty"`         // 触发来源摘要
	Checksum             string `json:"checksum"`                          // 联合 checksum（sha256 拼接）
	GeneratorVersion     string `json:"generator_version,omitempty"`       // 生成器版本
	SupersededByChangeNo string `json:"superseded_by_change_no,omitempty"` // 被更晚 pending 取代时指向新单
	SupersedesChangeNo  string `json:"supersedes_change_no,omitempty"`    // 取代更早 pending 时指向旧单
}

// ValidValidationStatus 返回合法的 validation_status 取值集合。
func ValidValidationStatus() []string {
	return []string{
		string(ValidationStatusPassed),
		string(ValidationStatusFailed),
		string(ValidationStatusPending),
		string(ValidationStatusRejected),
	}
}

// ValidChangeItemTargets 返回合法的变更对象取值集合。
func ValidChangeItemTargets() []string {
	return []string{
		string(ChangeItemTargetScrapeJob),
		string(ChangeItemTargetTargetInstance),
		string(ChangeItemTargetMonitoringRule),
		string(ChangeItemTargetProbeTarget),
		string(ChangeItemTargetLabelTemplate),
	}
}

// ValidChangeItemTypes 返回合法的变更类型取值集合。
func ValidChangeItemTypes() []string {
	return []string{
		string(ChangeItemTypeAdd),
		string(ChangeItemTypeUpdate),
		string(ChangeItemTypeDelete),
	}
}

// ValidRisks 返回合法的风险等级取值集合。
func ValidRisks() []string { return []string{string(RiskLow), string(RiskHigh)} }

// ValidAffectedFiles 返回合法的受影响配置文件取值集合。
func ValidAffectedFiles() []string {
	return []string{
		string(AffectedFilePrometheus),
		string(AffectedFileTargets),
		string(AffectedFileRules),
		string(AffectedFileBlackbox),
	}
}

// ValidValidationStatus 近义：校验一个 validation_status 是否合法。
func IsValidValidationStatus(s string) bool {
	for _, v := range ValidValidationStatus() {
		if v == s {
			return true
		}
	}
	return false
}

// IsValidRisk 校验一个风险等级是否合法。
func IsValidRisk(r string) bool {
	for _, v := range ValidRisks() {
		if v == r {
			return true
		}
	}
	return false
}

// TokenMasked 返回完全脱敏的 token（不显明文片段，契约 §3 / §9），
// 用于列表 / 详情展示；明文仅签发 / 重置单次返回。
func TokenMasked(token string) string {
	if token == "" {
		return ""
	}
	return strings.Repeat("*", len(token))
}