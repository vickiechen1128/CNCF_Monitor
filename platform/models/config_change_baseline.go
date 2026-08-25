package models

import "time"

// ChangeDetectStatus 表示某网域最近一次变更检测的执行结果（决策 42-4 可观测状态）。
type ChangeDetectStatus string

const (
	DetectStatusIdle           ChangeDetectStatus = "idle"           // 源数据未变化 / 无待确认单，跳过
	DetectStatusGenerated      ChangeDetectStatus = "generated"      // 已生成变更单
	DetectStatusSkippedPending ChangeDetectStatus = "skipped_pending" // 已有活 pending，等待用户处理后再检测
	DetectStatusFailed         ChangeDetectStatus = "failed"         // 生成失败，不推进版本，下轮重试
)

// ConfigChangeBaseline 记录某网域「自动变更检测」的持久化基线（PRD §3.3.3 轮询）。
//
// 基线落地为 DB 持久记录，而非内存态取「该域最新草稿 / 已确认版本 metadata 的
// SourceDataVersion」作 prev：保证服务重启不误判；首启（无基线记录）仅做初始化
// 基线 = 当前源数据版本并跳过本轮，不会对全部网域误生成一轮噪声草稿。
//
// DetectStatus / LastError / LastCheckedAt 承载决策 42-4 的「生成失败可观测状态」，
// 供日志与后续运维排查；生成失败时不推进 SourceVersion，下轮重试。
//
// IntervalSeconds / BackoffLevel / NextCheckAt 承载自适应退避：近期有变更时间隔
// 缩至最小，长期无变化则指数退避至最大，兼顾单网域实时性与多网域资源开销。
type ConfigChangeBaseline struct {
	BaseModel
	NetworkDomainID string              `gorm:"size:64;not null;uniqueIndex" json:"network_domain_id"`
	SourceVersion   string              `gorm:"size:128" json:"source_version"` // 最近一次成功生成草稿时的源数据版本
	DetectStatus    ChangeDetectStatus  `gorm:"size:20;not null" json:"detect_status"`
	LastError       string              `gorm:"type:text" json:"last_error,omitempty"`
	LastCheckedAt   *time.Time           `json:"last_checked_at,omitempty"`
	IntervalSeconds int                 `gorm:"default:0" json:"interval_seconds"` // 当前实际检测间隔（秒）
	BackoffLevel    int                 `gorm:"default:0" json:"backoff_level"`  // 连续无变化次数
	NextCheckAt     *time.Time           `json:"next_check_at,omitempty"`          // 下一次应检测时间
}

// TableName returns the GORM table name.
func (ConfigChangeBaseline) TableName() string { return "config_change_baselines" }