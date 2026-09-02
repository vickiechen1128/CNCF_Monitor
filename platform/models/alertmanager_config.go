// Package models 承载 MetricCenter 领域模型。
// 本文件集中定义 Module_08 告警收敛与通知管理的模型与 JSON 载体：
// （AlertmanagerConfigVersion 版本留痕 / AlertmanagerConfigStatus 状态枚举 /
// SilenceMatcher 静默 matcher DTO / AuthorizedMatcherScope 授权网域集合校验载体 /
// ValidateErrorItem 挂载校验行级错误）。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §6.6（AlertmanagerConfigVersion）/ §5.2（静默）/ §9.2（验收）；
//   docs/05-execution-records/module-08/api-contract-snapshot.md §3/§4。
// 决策 59/60：校验失败不落库，本表恒为 applied，不存在 failed / error_msg。
package models

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"time"
)

// AlertmanagerConfigStatus 表示留痕版本的状态（决策 60：校验失败不落库，恒 applied）。
type AlertmanagerConfigStatus string

// Alertmanager config version status 常量（唯一取值 applied）。
const (
	AlertmanagerConfigStatusApplied AlertmanagerConfigStatus = "applied"
)

// AlertmanagerConfigVersion 是 alertmanager.yml 挂载留痕版本（决策 59 内容留痕）。
//
//	ID            主键（自增）
//	Content       完整 alertmanager.yml 文本
//	Checksum      Content 的 sha256（十六进制小写）
//	AppliedAt     M09 下发 reload 成功时间（回写后才回填；挂载时为空）
//	AppliedBy     应用/挂载人（挂载时为上传者；M09 下发回写时以回写为准）
//	Status        恒 applied（校验失败不落库，决策 60）
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
func (v AlertmanagerConfigVersion) MarshalJSON() ([]byte, error) {
	type view struct {
		ID             string  `json:"id"`
		Content        string  `json:"content"`
		Checksum       string  `json:"checksum"`
		AppliedAt      *time.Time `json:"applied_at,omitempty"`
		AppliedBy      string  `json:"applied_by,omitempty"`
		Status         string  `json:"status"`
		CreatedAt      time.Time `json:"created_at"`
		SourceChangeNo string  `json:"source_change_no,omitempty"`
	}
	return json.Marshal(view{
		ID:             strconv.FormatUint(uint64(v.ID), 10),
		Content:        v.Content,
		Checksum:       v.Checksum,
		AppliedAt:      v.AppliedAt,
		AppliedBy:      v.AppliedBy,
		Status:         string(v.Status),
		CreatedAt:      v.CreatedAt,
		SourceChangeNo: v.SourceChangeNo,
	})
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