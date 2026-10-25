// Package history 实现 Module_08「历史告警」能力：
//
//   - webhook 事件流：Alertmanager 每次通知把告警推送至 POST /api/v1/webhooks/alerts，
//     按 fingerprint 合并为「一行 = 一次告警发生」（firing 判重、resolved 回填、兜底插入）；
//   - 分钟级对账：以 Alertmanager 活跃告警全集为准，对齐静默/抑制状态、补插漏记、
//     关闭已消失的未结行（恢复通知被吞的场景只能是近似终态，恢复时间不伪造）；
//   - 服务端分页查询 + 首页统计。
//
// 设计口径对齐参考实现（MonitorStack 历史告警）：webhook 负责真实事件时刻，对账负责
// 状态快照与缺口修复，两者各补对方盲区。写入权单一：未结三态互跳只由对账写。
package history

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

const (
	// WebhookPath 是 Alertmanager 历史留痕 webhook 的固定路径。
	// 必须与 generator 生成 receiver 时使用的路径严格一致（变更时两处同步）。
	WebhookPath = "/api/v1/webhooks/alerts"
	// maxWebhookBodyBytes 是 webhook 请求体上限（告警组报文，正常远小于此）。
	maxWebhookBodyBytes = 2 << 20

	// sourceWebhook / sourceReconcile 标识记录写入来源。
	sourceWebhook   = "webhook"
	sourceReconcile = "reconcile"

	// alertNamePlaceholder 是缺 alertname 标签时的展示占位。
	alertNamePlaceholder = "（无 alertname）"
)

// Payload 是 Alertmanager webhook 报文（v4）的最小结构；只解码用到的字段。
type Payload struct {
	Version         string         `json:"version"`
	Status          string         `json:"status"`
	Receiver        string         `json:"receiver"`
	GroupKey        string         `json:"groupKey"`
	TruncatedAlerts uint64         `json:"truncatedAlerts"`
	Alerts          []PayloadAlert `json:"alerts"`
}

// PayloadAlert 是 webhook 报文中的单条告警。
type PayloadAlert struct {
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    time.Time         `json:"startsAt"`
	EndsAt      time.Time         `json:"endsAt"`
	Fingerprint string            `json:"fingerprint"`
}

// IngestResult 是一次 webhook 落库的逐条统计（仅用于日志观测）。
type IngestResult struct {
	Received int
	Inserted int
	Updated  int
	Skipped  int
	Failed   int
}

// ingestOutcome 是单条告警的落库结果（仅用于统计）。
type ingestOutcome int

const (
	outcomeInserted ingestOutcome = iota
	outcomeUpdated
	outcomeSkipped
)

// Ingest 把一次 webhook 推送逐条合并进 alert_events。
//
// 纪律（参考实现 §6）：对推送方永远 2xx——单条失败只记日志跳过，不炸整批、不返回
// 错误给 Alertmanager（避免毒消息无限重试）。故函数不返回 error，失败计入 Failed。
func Ingest(db *gorm.DB, p Payload, now time.Time) IngestResult {
	res := IngestResult{Received: len(p.Alerts)}
	for i := range p.Alerts {
		outcome, err := ingestOne(db, p, p.Alerts[i], now)
		if err != nil {
			log.Printf("[alert-history] webhook ingest failed alert=%q fingerprint=%q: %v",
				p.Alerts[i].Labels["alertname"], p.Alerts[i].Fingerprint, err)
			res.Failed++
			continue
		}
		switch outcome {
		case outcomeInserted:
			res.Inserted++
		case outcomeUpdated:
			res.Updated++
		default:
			res.Skipped++
		}
	}
	if p.TruncatedAlerts > 0 {
		log.Printf("[alert-history] webhook truncated alerts=%d group_key=%q（对账将补记）",
			p.TruncatedAlerts, p.GroupKey)
	}
	return res
}

// ingestOne 处理单条告警：firing 判重 / resolved 回填 / 无指纹原样落库。
// 返回被唯一索引拦下的并发重复时按 skipped 处理（结果等价于跳过）。
func ingestOne(db *gorm.DB, group Payload, a PayloadAlert, now time.Time) (ingestOutcome, error) {
	status := normalizePayloadStatus(a.Status)
	fingerprint := strings.TrimSpace(a.Fingerprint)

	labels := a.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	annotations := a.Annotations
	if annotations == nil {
		annotations = map[string]string{}
	}

	if fingerprint == "" {
		// 无指纹：无法合并与对账，原样落库（参考实现 §8）。
		return outcomeInserted, db.Create(
			buildEvent(group, a, status, nil, labels, annotations, now, sourceWebhook)).Error
	}

	if status == models.AlertEventStatusResolved {
		endsAt := a.EndsAt
		if endsAt.IsZero() {
			endsAt = now
		}
		return resolveEvent(db, fingerprint, endsAt, now)
	}

	// firing：已有未结行（含被对账改成静默/抑制的行）→ 只刷新最后通知时间，不改状态。
	// 用 Find + RowsAffected 而非 First，避免「无未结行」这一常态路径打 record not found 日志。
	var open models.AlertEvent
	res := db.Where("fingerprint = ? AND status IN ?", fingerprint, models.AlertEventOpenStatuses).
		Order("id DESC").Limit(1).Find(&open)
	if res.Error != nil {
		return outcomeSkipped, fmt.Errorf("load open alert event: %w", res.Error)
	}
	if res.RowsAffected > 0 {
		return outcomeSkipped, db.Model(&models.AlertEvent{}).Where("id = ?", open.ID).
			UpdateColumn("last_notified_at", now).Error
	}

	// 无未结行 → 新一次发生。唯一索引兜底 webhook 与对账并发双插。
	err := db.Create(buildEvent(group, a, models.AlertEventStatusFiring, nil, labels, annotations, now, sourceWebhook)).Error
	if isUniqueViolation(err) {
		return outcomeSkipped, nil
	}
	return outcomeInserted, err
}

// resolveEvent 将 fingerprint 对应的未结 / 丢失 / 静默结束行回填为已恢复。
// 无行时兜底插入（触发推送曾丢失，恢复事实同样要留痕）。
func resolveEvent(db *gorm.DB, fingerprint string, endsAt, now time.Time) (ingestOutcome, error) {
	resolvable := append([]models.AlertEventStatus{}, models.AlertEventOpenStatuses...)
	resolvable = append(resolvable, models.AlertEventStatusLost, models.AlertEventStatusSilencedClosed)

	// 最多两轮：第一轮 CAS 撞车（对账并发改状态）或兜底插入撞唯一索引时，
	// 重新读取一次再回填，避免真实恢复时间因竞态丢失。
	for attempt := 0; attempt < 2; attempt++ {
		var ev models.AlertEvent
		res := db.Where("fingerprint = ? AND status IN ?", fingerprint, resolvable).
			Order("id DESC").Limit(1).Find(&ev)
		if res.Error != nil {
			return outcomeSkipped, fmt.Errorf("load alert event to resolve: %w", res.Error)
		}
		if res.RowsAffected > 0 {
			upd := db.Model(&models.AlertEvent{}).
				Where("id = ? AND status = ?", ev.ID, ev.Status).
				Updates(map[string]interface{}{
					"status":           models.AlertEventStatusResolved,
					"ends_at":          endsAt,
					"last_notified_at": now,
				})
			if upd.Error != nil {
				return outcomeUpdated, upd.Error
			}
			if upd.RowsAffected > 0 {
				return outcomeUpdated, nil
			}
			continue // CAS 输家：状态已被对账改走，重读后再试
		}

		// 兜底插入 resolved 行：labels/annotations 缺失也能留下恢复事实。
		placeholder := PayloadAlert{
			Status:      "resolved",
			Labels:      map[string]string{},
			Annotations: map[string]string{},
			StartsAt:    endsAt,
			EndsAt:      endsAt,
			Fingerprint: fingerprint,
		}
		err := db.Create(buildEvent(Payload{Status: "resolved", GroupKey: ""}, placeholder,
			models.AlertEventStatusResolved, &endsAt, placeholder.Labels, placeholder.Annotations, now, sourceWebhook)).Error
		if isUniqueViolation(err) {
			continue // 并发插入了未结行：重读后回填，别把真实恢复时间丢掉
		}
		return outcomeInserted, err
	}
	return outcomeSkipped, nil
}

// buildEvent 由推送/实况构造落库模型并做字段截断。
func buildEvent(
	group Payload,
	a PayloadAlert,
	status models.AlertEventStatus,
	endsAt *time.Time,
	labels, annotations map[string]string,
	now time.Time,
	source string,
) *models.AlertEvent {
	startsAt := a.StartsAt
	if startsAt.IsZero() {
		startsAt = now
	}
	alertName := strings.TrimSpace(labels["alertname"])
	if alertName == "" {
		alertName = alertNamePlaceholder
	}
	labelsJSON, _ := json.Marshal(labels)
	annotationsJSON, _ := json.Marshal(annotations)
	return &models.AlertEvent{
		Fingerprint:    strings.TrimSpace(a.Fingerprint),
		AlertName:      truncateRunes(alertName, 200),
		Status:         status,
		Severity:       truncateRunes(labels["severity"], 20),
		Summary:        truncateRunes(annotations["summary"], 500),
		Description:    annotations["description"],
		NetworkDomain:  models.ResolveNetworkDomain(labels),
		Labels:         string(labelsJSON),
		Annotations:    string(annotationsJSON),
		StartsAt:       &startsAt,
		EndsAt:         endsAt,
		GroupKey:       truncateRunes(group.GroupKey, 200),
		Receiver:       truncateRunes(group.Receiver, 100),
		Source:         source,
		LastNotifiedAt: &now,
	}
}

// normalizePayloadStatus 归一推送状态：只有 resolved 是恢复，其余（firing/空/异常词）
// 一律按 firing 处理，防奇怪词原样落库。
func normalizePayloadStatus(s string) models.AlertEventStatus {
	if strings.EqualFold(strings.TrimSpace(s), "resolved") {
		return models.AlertEventStatusResolved
	}
	return models.AlertEventStatusFiring
}

// isUniqueViolation 判定 SQLite 唯一索引冲突（并发重复插入的预期结果）。
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint failed") || strings.Contains(msg, "constraint failed")
}

// truncateRunes 按字符（非字节）截断，避免中文超列宽。
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
