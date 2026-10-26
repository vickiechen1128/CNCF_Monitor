// Package history 实现 Module_08「历史告警」能力：
//
//   - webhook 事件流：Alertmanager 每次通知把告警推送至 POST /api/v1/webhooks/alerts，
//     按 occurrence（指纹 + 开始时间）合并为「一行 = 一次告警发生」；
//   - 分钟级对账：以 Alertmanager 活跃告警全集为准，对齐静默/抑制状态、补插漏记、
//     关闭已消失的未结行（恢复通知被吞的场景只能是近似终态，恢复时间不伪造）；
//   - 服务端分页查询 + 首页统计。
//
// 设计口径对齐参考实现（MonitorStack 历史告警）：webhook 负责真实事件时刻，对账负责
// 状态快照与缺口修复，两者各补对方盲区。写入权单一：未结三态互跳只由对账写。
//
// 时间口径：表内所有时间字段统一按 UTC+8 带偏移存储；occurrence 去重键归一化时
// 使用 UTC 毫秒（只用于哈希，不落库展示）。
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
	now = models.NormalizeAlertEventTime(now)
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

// ingestOne 处理单条告警：
//   - 先按 occurrence_key（指纹 + 归一化开始时间）找同一发生；
//   - 找不到再用 fingerprint 找未结行（兼容 resolved 报文 startsAt 缺失/精度不一致）；
//   - 仍未命中才插入新行。
//
// firing 重复只刷新展示字段与最后通知时间，不改状态；resolved 回填真实恢复时间。
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

	var endsAt *time.Time
	if status == models.AlertEventStatusResolved {
		if a.EndsAt.IsZero() {
			// 不伪造恢复时间：留给对账按「恢复信息丢失」关闭。
			log.Printf("[alert-history] resolved webhook without endsAt fingerprint=%q dropped", fingerprint)
			return outcomeSkipped, nil
		}
		t := models.NormalizeAlertEventTime(a.EndsAt)
		endsAt = &t
	}

	startsAt := a.StartsAt
	if startsAt.IsZero() {
		if endsAt != nil {
			startsAt = *endsAt
		} else {
			startsAt = now
		}
	}
	startsAt = models.NormalizeAlertEventTime(startsAt)
	occurrenceKey := models.AlertEventOccurrenceKey(fingerprint, startsAt)

	if occurrenceKey != "" {
		var ev models.AlertEvent
		hit, err := findByOccurrenceKey(db, occurrenceKey, &ev)
		if err != nil {
			return outcomeSkipped, fmt.Errorf("load alert event by occurrence: %w", err)
		}
		if hit {
			return applyExisting(db, group, status, &ev, endsAt, now, labels, annotations)
		}
	}

	// 指纹回退：occurrence 没命中时，按 fingerprint 找最近未结行，保证恢复事实落到原行。
	if fingerprint != "" {
		var open models.AlertEvent
		res := db.Where("fingerprint = ? AND status IN ?", fingerprint, models.AlertEventOpenStatuses).
			Order("id DESC").Limit(1).Find(&open)
		if res.Error != nil {
			return outcomeSkipped, fmt.Errorf("load open alert event: %w", res.Error)
		}
		if res.RowsAffected > 0 {
			return applyExisting(db, group, status, &open, endsAt, now, labels, annotations)
		}
	}

	// resolved 重复推送兜底：报文缺 startsAt / 精度不一致时 occurrence 会变，
	// 若同一指纹 + 同一 endsAt 已有真实恢复行，按幂等忽略，不能插出重复发生。
	if status == models.AlertEventStatusResolved && fingerprint != "" && endsAt != nil {
		var resolved models.AlertEvent
		res := db.Where("fingerprint = ? AND status = ? AND ends_at = ?",
			fingerprint, models.AlertEventStatusResolved, *endsAt).
			Order("id DESC").Limit(1).Find(&resolved)
		if res.Error != nil {
			return outcomeSkipped, fmt.Errorf("load resolved alert event: %w", res.Error)
		}
		if res.RowsAffected > 0 {
			return outcomeSkipped, nil
		}
	}

	return insertNew(db, group, status, fingerprint, startsAt, endsAt, now, labels, annotations)
}

// applyExisting 把推送应用到已存在的发生行。
func applyExisting(
	db *gorm.DB,
	group Payload,
	status models.AlertEventStatus,
	ev *models.AlertEvent,
	endsAt *time.Time,
	now time.Time,
	labels, annotations map[string]string,
) (ingestOutcome, error) {
	if status != models.AlertEventStatusResolved {
		return refreshFiring(db, ev, now, group, labels, annotations)
	}
	return updateResolved(db, ev, *endsAt, now)
}

// refreshFiring 处理 firing 推送落到已存在的发生行：
// 只刷新展示字段与最后通知时间，不改状态、不复活已结束的发生。
func refreshFiring(
	db *gorm.DB,
	ev *models.AlertEvent,
	now time.Time,
	group Payload,
	labels, annotations map[string]string,
) (ingestOutcome, error) {
	updates := map[string]interface{}{
		"last_notified_at": now,
		"updated_at":       now,
	}
	for k, v := range displayUpdates(group, labels, annotations) {
		updates[k] = v
	}
	if err := db.Model(&models.AlertEvent{}).Where("id = ?", ev.ID).Updates(updates).Error; err != nil {
		return outcomeSkipped, err
	}
	return outcomeSkipped, nil
}

// updateResolved 回填真实恢复时间：status=resolved、ends_at=closed_at=AM 的 endsAt。
// 已 resolved 且已有真实恢复时间的重复推送幂等忽略；CAS 撞车时重读重试。
func updateResolved(
	db *gorm.DB,
	ev *models.AlertEvent,
	endsAt time.Time,
	now time.Time,
) (ingestOutcome, error) {
	for attempt := 0; attempt < 2; attempt++ {
		if ev.Status == models.AlertEventStatusResolved && ev.EndsAt != nil {
			return outcomeSkipped, nil
		}
		res := db.Model(&models.AlertEvent{}).
			Where("id = ? AND (ends_at IS NULL OR status <> ?)", ev.ID, models.AlertEventStatusResolved).
			Updates(map[string]interface{}{
				"status":           models.AlertEventStatusResolved,
				"ends_at":          endsAt,
				"closed_at":        endsAt,
				"last_notified_at": now,
				"updated_at":       now,
			})
		if res.Error != nil {
			return outcomeUpdated, res.Error
		}
		if res.RowsAffected > 0 {
			return outcomeUpdated, nil
		}
		// CAS 输家：对账并发改了状态，重读后再判断。
		if err := db.Where("id = ?", ev.ID).First(ev).Error; err != nil {
			return outcomeSkipped, fmt.Errorf("reload alert event %d: %w", ev.ID, err)
		}
	}
	return outcomeSkipped, nil
}

// insertNew 插入一条新发生。
func insertNew(
	db *gorm.DB,
	group Payload,
	status models.AlertEventStatus,
	fingerprint string,
	startsAt time.Time,
	endsAt *time.Time,
	now time.Time,
	labels, annotations map[string]string,
) (ingestOutcome, error) {
	var closedAt *time.Time
	if status == models.AlertEventStatusResolved {
		closedAt = endsAt
	}
	ev := buildEvent(group, status, fingerprint, startsAt, endsAt, closedAt,
		labels, annotations, now, sourceWebhook)
	if err := db.Create(ev).Error; err != nil {
		if isUniqueViolation(err) {
			return outcomeSkipped, nil
		}
		return outcomeInserted, err
	}
	return outcomeInserted, nil
}

// findByOccurrenceKey 按一次发生的去重键查找记录。
func findByOccurrenceKey(db *gorm.DB, key string, dest *models.AlertEvent) (bool, error) {
	res := db.Where("occurrence_key = ?", key).Order("id DESC").Limit(1).Find(dest)
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// buildEvent 由推送构造落库模型并做字段截断。
func buildEvent(
	group Payload,
	status models.AlertEventStatus,
	fingerprint string,
	startsAt time.Time,
	endsAt *time.Time,
	closedAt *time.Time,
	labels, annotations map[string]string,
	now time.Time,
	source string,
) *models.AlertEvent {
	startsAt = models.NormalizeAlertEventTime(startsAt)
	if endsAt != nil {
		v := models.NormalizeAlertEventTime(*endsAt)
		endsAt = &v
	}
	if closedAt != nil {
		v := models.NormalizeAlertEventTime(*closedAt)
		closedAt = &v
	}

	alertName := strings.TrimSpace(labels["alertname"])
	if alertName == "" {
		alertName = alertNamePlaceholder
	}
	labelsJSON, _ := json.Marshal(labels)
	annotationsJSON, _ := json.Marshal(annotations)
	return &models.AlertEvent{
		BaseModel: models.BaseModel{
			CreatedAt: now,
			UpdatedAt: now,
		},
		Fingerprint:    fingerprint,
		OccurrenceKey:  models.AlertEventOccurrenceKey(fingerprint, startsAt),
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
		ClosedAt:       closedAt,
		GroupKey:       truncateRunes(group.GroupKey, 200),
		Receiver:       truncateRunes(group.Receiver, 100),
		Source:         source,
		LastNotifiedAt: &now,
	}
}

// displayUpdates 是推送可刷新的展示字段集合；labels/annotations 为空时不覆盖存量内容。
func displayUpdates(
	group Payload,
	labels, annotations map[string]string,
) map[string]interface{} {
	if len(labels) == 0 && len(annotations) == 0 {
		return map[string]interface{}{}
	}
	alertName := strings.TrimSpace(labels["alertname"])
	if alertName == "" {
		alertName = alertNamePlaceholder
	}
	labelsJSON, _ := json.Marshal(labels)
	annotationsJSON, _ := json.Marshal(annotations)
	return map[string]interface{}{
		"alert_name":     truncateRunes(alertName, 200),
		"severity":       truncateRunes(labels["severity"], 20),
		"summary":        truncateRunes(annotations["summary"], 500),
		"description":    annotations["description"],
		"network_domain": models.ResolveNetworkDomain(labels),
		"labels":         string(labelsJSON),
		"annotations":    string(annotationsJSON),
		"group_key":      truncateRunes(group.GroupKey, 200),
		"receiver":       truncateRunes(group.Receiver, 100),
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
