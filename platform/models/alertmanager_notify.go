// Package models 承载 MetricCenter 领域模型。
// 本文件定义 Module_08 告警收敛与通知管理（PL-3 通知渲染桥）的模型与枚举：
// NotifyChannel（通知渠道）/ NotifyTemplate（通知模板，版本化留痕）/
// NotifyChannelType（渠道类型枚举）/ NotifyTemplateStatus（模板状态枚举）。
// 参见 docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md
//   §3.3.2（数据模型）/ §3.3.8（接口契约汇总）；docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md。
// 决策口径：模板校验失败不落库（照抄决策 59/60），status 恒 applied；checksum 复用
// AlertmanagerConfigChecksum（sha256 十六进制小写）。
package models

import (
	"regexp"
	"strconv"
	"strings"
)

// receiverNamePattern 匹配非 [a-z0-9] 连续片段，用于归一为单个 '-'。
var receiverNamePattern = regexp.MustCompile(`[^a-z0-9]+`)

// SanitizeReceiverName 由渠道名 / 接收人名生成合法 AM receiver 名：转小写、非 [a-z0-9]
// 字符归一为 '-'、压缩连续 '-'、去首尾 '-'；结果可为空（调用方负责回落 notify-<id> 或报错）。
//
// 单一实现：notify 包接收人片段（receiver_snippet.go）与 M09 生成器物化 receivers
// （configcenter/generator）必须同源（决策 74 定稿第 1 条：禁止两处各写一份造成漂移）。
func SanitizeReceiverName(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = receiverNamePattern.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// ReceiverName 返回渠道的建议 AM receiver 名：渠道名 sanitize 后为空回落 notify-<id>。
func (c NotifyChannel) ReceiverName() string {
	if n := SanitizeReceiverName(c.Name); n != "" {
		return n
	}
	return "notify-" + strconv.FormatUint(uint64(c.ID), 10)
}

// NotifyChannelType 表示通知渠道类型（设计提案 §3.3.2：feishu / dingtalk / wecom）。
type NotifyChannelType string

// 通知渠道类型常量。
const (
	NotifyChannelTypeFeishu   NotifyChannelType = "feishu"
	NotifyChannelTypeDingtalk NotifyChannelType = "dingtalk"
	NotifyChannelTypeWecom    NotifyChannelType = "wecom"
)

// ValidNotifyChannelTypes 返回合法的通知渠道类型取值集合。
func ValidNotifyChannelTypes() []string {
	return []string{
		string(NotifyChannelTypeFeishu),
		string(NotifyChannelTypeDingtalk),
		string(NotifyChannelTypeWecom),
	}
}

// IsValidNotifyChannelType 判定给定字符串是否为合法渠道类型。
func IsValidNotifyChannelType(t string) bool {
	switch NotifyChannelType(t) {
	case NotifyChannelTypeFeishu, NotifyChannelTypeDingtalk, NotifyChannelTypeWecom:
		return true
	default:
		return false
	}
}

// NotifyChannel 是通知渠道（设计提案 §3.3.2）：AM 侧只引用 ID、不暴露目标地址；
// WebhookURL / Secret 仅在平台侧存储（列表响应按需脱敏，脱敏在 notify 包的视图层完成）。
//
//	Name             渠道名称（如「SRE 飞书群」）
//	Type             渠道类型（feishu / dingtalk / wecom）
//	WebhookURL       机器人 Webhook 地址（含 token），仅平台侧存储
//	Secret           加签密钥（选填，启用加签时必填）
//	Enabled          启用状态
//	DefaultTemplateID 该渠道渲染时使用的通知模板（null = 用内置默认模板，零配置 Happy Path 不变）；
//	                  非空时须满足 template.channel_type == 本渠道 Type（渠道 CRUD 前置校验，桥亦有兜底）。
//	                  经 M09 物化写进 receiver URL 的 `&template=<ID>`，是「渠道 ↔ 模板一等绑定」的载体
//	                  （dev-feedback #30 / 设计提案 notify-template-channel-binding.md §5.1）。
type NotifyChannel struct {
	BaseModel
	Name              string            `gorm:"size:100;not null" json:"name"`
	Type              NotifyChannelType `gorm:"size:20;not null" json:"type"`
	WebhookURL        string            `gorm:"size:1024;not null" json:"webhook_url"`
	Secret            string            `gorm:"size:256" json:"secret,omitempty"`
	Enabled           bool              `gorm:"not null" json:"enabled"`
	DefaultTemplateID *uint             `gorm:"size:20" json:"default_template_id,omitempty"`
}

// TableName 返回 GORM 表名。
func (NotifyChannel) TableName() string { return "notify_channels" }

// NotifyTemplateStatus 表示通知模板留痕版本的状态（唯一取值 applied）。
type NotifyTemplateStatus string

// 通知模板状态常量（照抄决策 59/60：校验失败不落库，恒 applied）。
const (
	NotifyTemplateStatusApplied NotifyTemplateStatus = "applied"
)

// NotifyTemplate 是通知模板留痕版本（设计提案 §3.3.2，版本化留痕）：
// 每次提交 / 回滚写入一条 applied 记录，校验失败只回行级错误、不落库。
//
//	Name        模板名称
//	ChannelType 适用渠道类型（与渠道类型匹配后才可组合）
//	Content     Alertmanager 标准 Go template 文本（不是脚本）
//	IsBuiltin   平台内置默认模板（随版本升级）
//	Checksum    Content 的 sha256（复用 AlertmanagerConfigChecksum 口径）
//	Status      恒 applied（校验失败不落库）
type NotifyTemplate struct {
	BaseModel
	Name        string               `gorm:"size:100;not null" json:"name"`
	ChannelType NotifyChannelType    `gorm:"size:20;not null;index" json:"channel_type"`
	Content     string               `gorm:"type:text;not null" json:"content"`
	IsBuiltin   bool                 `gorm:"not null" json:"is_builtin"`
	Checksum    string               `gorm:"size:64;not null;index" json:"checksum"`
	Status      NotifyTemplateStatus `gorm:"size:20;not null" json:"status"`
}

// TableName 返回 GORM 表名。
func (NotifyTemplate) TableName() string { return "notify_templates" }