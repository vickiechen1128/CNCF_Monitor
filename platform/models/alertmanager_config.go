// Package models 承载 MetricCenter 领域模型。
// 本文件集中定义 Module_08 告警收敛与通知管理的模型与 JSON 载体：
// （AlertmanagerConfigVersion 版本留痕 / AlertmanagerConfigStatus 状态枚举 /
// SilenceMatcher 静默 matcher DTO / AuthorizedMatcherScope 授权网域集合校验载体 /
// ValidateErrorItem 挂载校验行级错误）。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//
//	§6.6（AlertmanagerConfigVersion）/ §5.2（静默）/ §9.2（验收）；
//	docs/05-execution-records/module-08/api-contract-snapshot.md §3/§4。
//
//	决策 59/60：校验失败不落库；状态取值 applied / discarded（2026-10-13 废弃联动修订，
//	见 AlertmanagerConfigStatus 注释与 dev-feedback #44）。
package models

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"
)

// AlertmanagerConfigStatus 表示留痕版本的状态。
//
// 历史口径（决策 60）：校验失败不落库，本表恒为 applied——挂载落库那一刻即置位，
// 表示「已收录为 M09 下发源」，不承诺已生效（生效信号是 applied_at）。
//
// 2026-10-13 修订（废弃联动，见 dev-feedback #44）：新增 discarded 终态。M09 变更单
// 被废弃（用户废弃 / 被更新单取代）时，已无活 pending 单可确认的留痕一律标记
// discarded——否则 applied_at 永为空、M08 版本历史永久显示「已提交，待确认下发」
// （用户实测 id=18 遗留问题）。applied（applied_at 空）= 待确认下发；
// applied（applied_at 有值）= 已生效；discarded = 已废弃（不随任何在途单下发）。
type AlertmanagerConfigStatus string

// Alertmanager config version status 常量。
const (
	AlertmanagerConfigStatusApplied   AlertmanagerConfigStatus = "applied"
	AlertmanagerConfigStatusDiscarded AlertmanagerConfigStatus = "discarded"
)

// AlertmanagerConfigVersion 是 alertmanager.yml 挂载留痕版本（决策 59 内容留痕）。
//
//	ID            主键（自增）
//	Content       完整 alertmanager.yml 文本
//	Checksum      Content 的 sha256（十六进制小写）
//	AppliedAt     M09 下发 reload 成功时间（回写后才回填；挂载时为空）
//	AppliedBy     应用/挂载人（挂载时为上传者；M09 下发回写时以回写为准）
//	Status        applied（待确认下发 / 已生效）或 discarded（已废弃，无活单可确认）
//	SourceChangeNo 关联 M09 管理域（default）变更单号（决策 60，管道侧确认后回填）
//	CreatedAt     挂载留痕时间（BaseModel）
type AlertmanagerConfigVersion struct {
	BaseModel
	Content        string                   `gorm:"type:text" json:"content"`
	Checksum       string                   `gorm:"size:64;not null;index" json:"checksum"`
	AppliedAt      *time.Time               `json:"applied_at,omitempty"`
	AppliedBy      string                   `gorm:"size:100" json:"applied_by,omitempty"`
	Status         AlertmanagerConfigStatus `gorm:"size:20;not null" json:"status"`
	SourceChangeNo string                   `gorm:"size:64" json:"source_change_no,omitempty"`
}

// TableName 返回 GORM 表名。
func (AlertmanagerConfigVersion) TableName() string { return "alertmanager_config_versions" }

// MarshalJSON 将版本序列化为契约视图：id 输出为字符串（契约 §6.6 id: string），
// 仅回显契约声明字段（含完整 content 供详情/当前生效）。deleted_at/updated_at 不回显。
// review-fix F4：created_at/applied_at 统一输出 RFC3339 秒级文本，与历史版本列表
// （config/version.go toListItem 用 time.RFC3339）精度对齐，避免详情/当前视图此前用
// time.Time 原生 RFC3339Nano（纳秒）造成两级精度不一致。
func (v AlertmanagerConfigVersion) MarshalJSON() ([]byte, error) {
	type view struct {
		ID             string  `json:"id"`
		Content        string  `json:"content"`
		Checksum       string  `json:"checksum"`
		AppliedAt      *string `json:"applied_at,omitempty"`
		AppliedBy      string  `json:"applied_by,omitempty"`
		Status         string  `json:"status"`
		CreatedAt      string  `json:"created_at"`
		SourceChangeNo string  `json:"source_change_no,omitempty"`
	}
	return json.Marshal(view{
		ID:             strconv.FormatUint(uint64(v.ID), 10),
		Content:        v.Content,
		Checksum:       v.Checksum,
		AppliedAt:      formatAMTimeOrNil(v.AppliedAt),
		AppliedBy:      v.AppliedBy,
		Status:         string(v.Status),
		CreatedAt:      v.CreatedAt.Format(time.RFC3339),
		SourceChangeNo: v.SourceChangeNo,
	})
}

// formatAMTimeOrNil 将 *time.Time 输出为 RFC3339 文本；nil 返回 nil（模型层本地助手，
// 与 config 包 formatTimeOrNil 口径一致；模型不下引 config 避免循环依赖）。
func formatAMTimeOrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.Format(time.RFC3339)
	return &s
}

// AlertmanagerConfigChecksum 计算 alertmanager.yml 内容的 sha256（十六进制小写）。
func AlertmanagerConfigChecksum(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// SilenceMatcher 是静默匹配条件 DTO（契约 §4 Matcher）。
//
//	Name    标签名（如 network_domain）
//	Value   匹配值
//	IsEqual true=`=`（相等）false=`!=`（不相等）
//	IsRegex true=正则匹配
type SilenceMatcher struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	IsEqual bool   `json:"is_equal"`
	IsRegex bool   `json:"is_regex"`
}

// SilenceStatus 表示静默在 Alertmanager 的运行时状态（契约 §6 枚举：active/pending/expired）。
type SilenceStatus string

// 静默运行态常量。
const (
	SilenceStatusActive  SilenceStatus = "active"
	SilenceStatusPending SilenceStatus = "pending"
	SilenceStatusExpired SilenceStatus = "expired"
)

// ValidSilenceStatus 返回合法的静默状态取值集合。
func ValidSilenceStatus() []string {
	return []string{
		string(SilenceStatusActive),
		string(SilenceStatusPending),
		string(SilenceStatusExpired),
	}
}

// AuthorizedMatcherScope 是服务端授权网域集合校验载体（决策 56）：
// 创建静默时校验每个 matcher 的值收敛于当前用户授权网域集合，越权 matcher 拒绝
// bad_request。MVP 单租户恒为 AllDomains=true（全部网域），作为机制骨架保留。
type AuthorizedMatcherScope struct {
	// AllDomains 为 true 表示授权全部网域（MVP 单租户恒 true），此时不附加任何约束。
	AllDomains bool
	// Domains 为授权网域 ID 集合；仅当 AllDomains=false 时参与收敛判定。
	Domains []string
}

// Violations 返回越权（不收敛于授权网域集合）的 matcher 列表。
// 判定规则：
//   - matcher 的 name 非网域标签（network_domain）时视为不涉及网域授权，不判越权；
//   - 授权全部网域（AllDomains）时恒返回空（MVP 单租户恒通过）；
//   - 否则对 name=network_domain 的 matcher，其 value 必须命中 Domains 集合。
//
// 返回空切片表示全部 matcher 合规。
func (s *AuthorizedMatcherScope) Violations(matchers []SilenceMatcher) []SilenceMatcher {
	if s.AllDomains {
		return nil
	}
	allowed := make(map[string]struct{}, len(s.Domains))
	for _, d := range s.Domains {
		allowed[d] = struct{}{}
	}
	violations := make([]SilenceMatcher, 0)
	for _, m := range matchers {
		if m.Name != "network_domain" {
			continue
		}
		if _, ok := allowed[m.Value]; !ok {
			violations = append(violations, m)
		}
	}
	return violations
}

// ValidateErrorItem 是挂载校验失败的行级错误项（契约 §3：file/line/message）。
// file 恒为 alertmanager.yml（单文件挂载）；line=0 表示无行号信息。
type ValidateErrorItem struct {
	File    string `json:"file"`
	Line    int    `json:"line,omitempty"`
	Message string `json:"message"`
}
