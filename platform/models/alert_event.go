// Package models — 历史告警事件（Module_08 历史告警能力）。
//
// 一行 = 一次告警发生（按 Alertmanager fingerprint 合并），不是通知流水账：
//   - firing 推送重复到达只刷新最后通知时间，不新增行；
//   - resolved 推送回填同一行的真实恢复时间；
//   - 恢复后再次触发按新一次发生插入新行。
//
// 七态与写入权（口径对齐参考实现 MonitorStack「历史告警」技术文档）：
//   - firing/silenced/inhibited 为未结三态，同一 fingerprint 至多一行（部分唯一索引）；
//   - resolved/silenced_closed/inhibited_closed/lost 为终态（lost 为准终态：
//     迟到的 resolved 可回填自愈）；
//   - 未结三态之间的互跳只由对账任务按 Alertmanager 实况写，webhook 只做
//     「插 firing 新行 / 回填 resolved」，避免迟到推送覆盖对账结论。
//
// 时间口径（2026-10-26 用户确认）：历史告警表所有时间字段统一按 UTC+8 带偏移存储，
// 便于直接查看与按自然日统计；occurrence_key 归一化时使用 UTC（去重键与时区无关）。
package models

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// AlertEventLocation 是历史告警时间字段的统一存储时区（UTC+8）。
// 只用于落库与查询边界归一化，不改变时间点本身。
var AlertEventLocation = time.FixedZone("UTC+8", 8*60*60)

// AlertEventStatus 是历史告警记录的七态。
type AlertEventStatus string

const (
	// AlertEventStatusFiring 告警中：已触发、未恢复、通知通畅。
	AlertEventStatusFiring AlertEventStatus = "firing"
	// AlertEventStatusSilenced 静默中：已触发、未恢复、被静默压着不通知。
	AlertEventStatusSilenced AlertEventStatus = "silenced"
	// AlertEventStatusInhibited 抑制中：已触发、未恢复、被更高级别告警抑制。
	AlertEventStatusInhibited AlertEventStatus = "inhibited"
	// AlertEventStatusResolved 已恢复：ends_at 为真实恢复时间。
	AlertEventStatusResolved AlertEventStatus = "resolved"
	// AlertEventStatusSilencedClosed 静默期间结束：静默吞掉了恢复通知，
	// 只能确认告警已消失，无法确认真实恢复时刻（ends_at 留空）。
	AlertEventStatusSilencedClosed AlertEventStatus = "silenced_closed"
	// AlertEventStatusInhibitedClosed 抑制期间结束：抑制吞掉了恢复通知，
	// 只能确认告警已消失，无法确认真实恢复时刻（ends_at 留空）。
	AlertEventStatusInhibitedClosed AlertEventStatus = "inhibited_closed"
	// AlertEventStatusLost 恢复信息丢失：平台没收到恢复消息（推送中断等异常），
	// ends_at 留空不伪造；迟到的 resolved 推送可回填自愈。
	AlertEventStatusLost AlertEventStatus = "lost"
)

// AlertEventOpenStatuses 是未结三态（同一 fingerprint 至多一行的约束范围）。
var AlertEventOpenStatuses = []AlertEventStatus{
	AlertEventStatusFiring,
	AlertEventStatusSilenced,
	AlertEventStatusInhibited,
}

// AlertEventTerminalStatuses 是终态集合（含准终态 lost / silenced_closed / inhibited_closed）。
var AlertEventTerminalStatuses = []AlertEventStatus{
	AlertEventStatusResolved,
	AlertEventStatusSilencedClosed,
	AlertEventStatusInhibitedClosed,
	AlertEventStatusLost,
}

// AlertEventInferredTerminalStatuses 是「恢复时间未知」的终态集合：
// 由对账判定关闭，closed_at 有值但 ends_at 为空。
var AlertEventInferredTerminalStatuses = []AlertEventStatus{
	AlertEventStatusSilencedClosed,
	AlertEventStatusInhibitedClosed,
	AlertEventStatusLost,
}

// IsOpenAlertEventStatus 判定是否为未结三态。
func IsOpenAlertEventStatus(s AlertEventStatus) bool {
	return s == AlertEventStatusFiring || s == AlertEventStatusSilenced || s == AlertEventStatusInhibited
}

// IsInferredAlertEventStatus 判定是否为「恢复时间未知」的终态。
func IsInferredAlertEventStatus(s AlertEventStatus) bool {
	return s == AlertEventStatusSilencedClosed || s == AlertEventStatusInhibitedClosed ||
		s == AlertEventStatusLost
}

// IsValidAlertEventStatus 判定是否为合法七态取值。
func IsValidAlertEventStatus(s AlertEventStatus) bool {
	return IsOpenAlertEventStatus(s) || s == AlertEventStatusResolved ||
		s == AlertEventStatusSilencedClosed || s == AlertEventStatusInhibitedClosed ||
		s == AlertEventStatusLost
}

// NormalizeAlertEventTime 把时刻转换为历史告警表的统一存储时区（UTC+8）。
func NormalizeAlertEventTime(t time.Time) time.Time {
	return t.In(AlertEventLocation)
}

// NormalizeAlertEventTimePtr 是 NormalizeAlertEventTime 的指针版本（nil 透传）。
func NormalizeAlertEventTimePtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := NormalizeAlertEventTime(*t)
	return &v
}

// AlertEventOccurrenceKey 返回一次告警发生的去重键：
// SHA-256(指纹 + "|" + 归一化到 UTC 毫秒的开始时间)。
//
// 归一化只用于哈希：统一转 UTC、截到毫秒、固定格式，避免 webhook 与对账
// 两个通道拿到的同一时刻因时区/精度写法不同而算出不同键。指纹为空时返回空串，
// 这类记录不参与 occurrence 唯一约束（保持「无指纹原样落库」的既有口径）。
func AlertEventOccurrenceKey(fingerprint string, startsAt time.Time) string {
	if fingerprint == "" {
		return ""
	}
	canonical := startsAt.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
	sum := sha256.Sum256([]byte(fingerprint + "|" + canonical))
	return hex.EncodeToString(sum[:])
}

// AlertEvent 是历史告警记录（历史告警表 alert_events）。
//
//	Fingerprint   Alertmanager 告警指纹（合并键；空指纹记录不参与合并与对账）
//	OccurrenceKey 一次发生的去重键（指纹 + UTC 毫秒开始时间的哈希；空指纹为空）
//	Status        七态（见 AlertEventStatus）
//	Labels/Annotations  告警原始标签 / 注解（JSON 文本，含 network_domain_id / resource_id）
//	StartsAt      真实触发时刻（来自 AM 推送 / 对账实况）
//	EndsAt        真实恢复时刻（仅 resolved 有值；其余状态恒空，不伪造）
//	ClosedAt      记录关闭时刻（所有终态都有值；resolved 时等于 EndsAt）
//	UpdatedAt     记录最后一次内容变化时间
type AlertEvent struct {
	BaseModel
	Fingerprint   string           `gorm:"size:64;index" json:"fingerprint,omitempty"`
	OccurrenceKey string           `gorm:"size:64" json:"occurrence_key,omitempty"`
	AlertName     string           `gorm:"size:200;index" json:"alert_name"`
	Status        AlertEventStatus `gorm:"size:32;not null;index" json:"status"`
	Severity      string           `gorm:"size:20;index" json:"severity,omitempty"`
	Summary       string           `gorm:"size:500" json:"summary,omitempty"`
	Description   string           `gorm:"type:text" json:"description,omitempty"`
	NetworkDomain string           `gorm:"size:64;index" json:"network_domain,omitempty"`
	Labels        string           `gorm:"type:text" json:"labels,omitempty"`
	Annotations   string           `gorm:"type:text" json:"annotations,omitempty"`
	StartsAt      *time.Time       `gorm:"index" json:"starts_at,omitempty"`
	EndsAt        *time.Time       `json:"ends_at,omitempty"`
	ClosedAt      *time.Time       `gorm:"index" json:"closed_at,omitempty"`
	GroupKey      string           `gorm:"size:200" json:"group_key,omitempty"`
	Receiver      string           `gorm:"size:100" json:"receiver,omitempty"`
	// Source 标识记录来源：webhook（实时推送）/ reconcile（对账补插）/ backfill（升级回填）。
	Source string `gorm:"size:20" json:"source,omitempty"`
	// LastNotifiedAt 是最近一次收到该告警 webhook 推送的时刻（未结行重复推送时刷新）。
	LastNotifiedAt *time.Time `json:"last_notified_at,omitempty"`
}

// TableName 返回 GORM 表名。
func (AlertEvent) TableName() string { return "alert_events" }
