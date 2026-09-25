package models

import "time"

// EdgeTargetSnapshot 表示边缘 vmagent 本地 target 的抓取快照（方案 B，随心跳上报
// 中心后落库），供 M09「监控目标状态」页排障与下一阶段 /api/v1/targets 融合。
// 字段对齐 agent 侧 contract.EdgeTargetSnapshot 与 edge.HeartbeatRequest.Targets，
// json tag 用 snake_case 与上报契约一致。
//
// 落库口径（F-11 定版）：
//   - 每轮心跳 clear-then-insert：硬删该 edge_agent_id 上轮全部快照，再批量插入本轮，
//     (network_domain_id, job, instance) 经 uniqueIndex 兜底保证覆盖更新，不无限追加。
//   - 快照属高频瞬时状态、无审计价值，采用硬删（Unscoped）而非软删——软删会占用唯一
//     索引导致同键重插冲突。
//   - LastReportAt 记录中心接收时间，供融合阶段判断「agent 离线后快照过期降级」。
//
// 参见 docs/05-execution-records/module-11/dev-feedback.md F-11。
type EdgeTargetSnapshot struct {
	BaseModel
	NetworkDomainID       string    `gorm:"size:64;not null;uniqueIndex:idx_etargets_uniq" json:"network_domain_id"`
	EdgeAgentID           uint      `gorm:"column:edge_agent_id;index" json:"edge_agent_id"`                 // agent 维度（冗余追溯；一个网域一个 agent）
	Job                   string    `gorm:"size:200;not null;uniqueIndex:idx_etargets_uniq" json:"job"`      // 标签 job
	Instance              string    `gorm:"size:300;not null;uniqueIndex:idx_etargets_uniq" json:"instance"` // 标签 instance（host:port）
	ResourceID            string    `gorm:"size:200" json:"resource_id"`                                     // prometheus.yml targets 注入标签，可能缺
	Health                string    `gorm:"size:20" json:"health"`                                           // up / down / unknown（透传字符串）
	LastScrape            string    `gorm:"size:64" json:"last_scrape"`                                      // 最近一次抓取时间（RFC3339）
	LastError             string    `gorm:"type:text" json:"last_error"`                                     // 最近抓取错误摘要
	ScrapeDurationSeconds float64   `gorm:"column:scrape_duration_seconds" json:"scrape_duration_seconds"`   // 最近一次抓取耗时（秒）
	LastReportAt          time.Time `gorm:"column:last_report_at;index" json:"last_report_at"`               // 本轮心跳接收时间（中心时间）
}

// TableName returns the GORM table name.
func (EdgeTargetSnapshot) TableName() string { return "edge_target_snapshots" }
