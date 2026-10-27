// reconciler.go 实现历史告警的分钟级对账：
//
//	webhook 事件流的盲区 = 被静默/抑制的告警通知被 Alertmanager 吞掉、推送本身可能丢；
//	对账以 Alertmanager 活跃告警全集为准，按 fingerprint+starts_at 的 occurrence ID 判重：
//	  1. 对齐同一 occurrence 的状态：静默中 / 抑制中 / 告警中（静默优先于抑制）；
//	  2. 恢复被误关的行：同一 occurrence 重新活跃的，在原行恢复未结束状态；
//	  3. 补插漏记的 occurrence（仅 state=active 的触发通知丢失）；
//	  4. 关闭已消失的旧 occurrence：静默中 → 静默期间结束；抑制中 → 抑制期间结束；
//	     其余 → 恢复信息丢失。同指纹不同 starts_at 属不同 occurrence，不得合并。
//
// 写入权单一：未结三态互跳只由本任务写（webhook 只插 firing / 回填 resolved）。
// 安全阀：
//   - Alertmanager 启动不足 3 分钟时只对齐/补插、不关行；
//   - 记录创建不足 2 分钟时不关/不补（webhook 可能还在路上）；
//   - 活跃集连续 2 轮为空才允许关行；
//   - 单轮待关闭占比 > 50% 且 > 10 条时本轮跳过，下一轮仍满足才执行。
package history

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

const (
	// reconcileInterval 是对账周期。
	reconcileInterval = 60 * time.Second
	// closeGrace 是「刚写入的行不关/不补」宽限：webhook 可能还在路上。
	closeGrace = 2 * time.Minute
	// amFreshness 是 Alertmanager 启动后的观察窗口：活跃集仍在重建时不关行。
	amFreshness = 3 * time.Minute
	// confirmRounds 是空活跃集 / 异常关闭比例的确认轮数：连续满足后才放行关闭。
	confirmRounds = 2
	// closeRatioThreshold / closeRatioMinRows 是单轮关闭比例安全阀：
	// 待关闭行数超过 closeRatioMinRows 且占比超过 closeRatioThreshold 时先缓一轮。
	closeRatioThreshold = 0.5
	closeRatioMinRows   = 10
)

// ActiveAlert 是对账所需的 Alertmanager 活跃告警实况（含静默/抑制/时间静音标记）。
type ActiveAlert struct {
	Fingerprint string
	Labels      map[string]string
	Annotations map[string]string
	StartsAt    time.Time
	EndsAt      time.Time
	State       string
	SilencedBy  []string
	InhibitedBy []string
	MutedBy     []string
}

// AlertSource 提供对账所需的 Alertmanager 实况。测试可注入假实现。
type AlertSource interface {
	// ListActiveAlerts 返回当前活跃告警全集（含 silenced / inhibited）。
	ListActiveAlerts(ctx context.Context) ([]ActiveAlert, error)
	// AlertmanagerStartedAt 返回 AM 进程启动时刻（用于重启重建窗口判定）。
	AlertmanagerStartedAt(ctx context.Context) (time.Time, error)
}

// Reconciler 是历史告警对账任务。
type Reconciler struct {
	db     *gorm.DB
	source AlertSource
	now    func() time.Time
	// emptyRounds / suspiciousRounds 是安全阀的连续轮次计数（单 goroutine 内使用）。
	emptyRounds      int
	suspiciousRounds int
}

// NewReconciler 创建对账任务。
func NewReconciler(db *gorm.DB, source AlertSource) *Reconciler {
	return &Reconciler{db: db, source: source, now: time.Now}
}

// Summary 是一轮对账的结果（仅用于日志观测）。
type Summary struct {
	Aligned    int
	Restored   int
	Closed     int
	Backfilled int
	Skipped    int
}

// Start 在独立 goroutine 中按周期对账，随 ctx 取消退出。
func (r *Reconciler) Start(ctx context.Context) {
	if r == nil || r.db == nil || r.source == nil {
		log.Printf("[alert-history] reconciler disabled (db/source is nil)")
		return
	}
	go func() {
		log.Printf("[alert-history] reconciler started, interval=%s", reconcileInterval)
		ticker := time.NewTicker(reconcileInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Printf("[alert-history] reconciler stopped")
				return
			case <-ticker.C:
				summary, err := r.RunOnce(ctx)
				if err != nil {
					log.Printf("[alert-history] reconcile skipped/failed: %v", err)
					continue
				}
				log.Printf("[alert-history] reconcile done aligned=%d restored=%d closed=%d backfilled=%d skipped=%d",
					summary.Aligned, summary.Restored, summary.Closed, summary.Backfilled, summary.Skipped)
			}
		}
	}()
}

// closeCandidate 是待关闭的未结行及其目标终态。
type closeCandidate struct {
	event  *models.AlertEvent
	target models.AlertEventStatus
}

// RunOnce 执行一轮对账。
func (r *Reconciler) RunOnce(ctx context.Context) (Summary, error) {
	var summary Summary
	if r == nil || r.db == nil || r.source == nil {
		return summary, errors.New("reconciler not initialized")
	}
	now := models.NormalizeAlertEventTime(r.now())

	startedAt, err := r.source.AlertmanagerStartedAt(ctx)
	if err != nil {
		// AM 不可达 / 状态未知：整轮跳过（不误杀）。
		return summary, fmt.Errorf("query alertmanager status: %w", err)
	}
	canClose := !startedAt.IsZero() && now.Sub(startedAt) >= amFreshness

	active, err := r.source.ListActiveAlerts(ctx)
	if err != nil {
		return summary, fmt.Errorf("query active alerts: %w", err)
	}

	activeByOccurrence := make(map[string]ActiveAlert, len(active))
	youngFingerprints := make(map[string]struct{}, len(active))
	for _, a := range active {
		startsAt := a.StartsAt
		if startsAt.IsZero() {
			startsAt = now
		}
		startsAt = models.NormalizeAlertEventTime(startsAt)
		occurrenceKey := models.AlertEventOccurrenceKey(a.Fingerprint, startsAt)
		if occurrenceKey == "" {
			continue
		}
		activeByOccurrence[occurrenceKey] = a
		if now.Sub(startsAt) < closeGrace {
			youngFingerprints[a.Fingerprint] = struct{}{}
		}
	}

	var open []models.AlertEvent
	if err := r.db.Where("status IN ?", models.AlertEventOpenStatuses).Find(&open).Error; err != nil {
		return summary, fmt.Errorf("load open alert events: %w", err)
	}

	stillOpen := make(map[string]struct{}, len(open))
	openByOccurrence := make(map[string]*models.AlertEvent, len(open))
	for i := range open {
		ev := &open[i]
		occurrenceKey := alertEventOccurrenceKey(ev)
		if occurrenceKey == "" {
			continue
		}
		stillOpen[occurrenceKey] = struct{}{}
		openByOccurrence[occurrenceKey] = ev

		a, exists := activeByOccurrence[occurrenceKey]
		if !exists {
			continue
		}
		desired := activeAlertStatus(a)
		if ev.Status == desired {
			continue
		}
		// CAS：读到的状态仍是原状态才改，撞车时输家命中 0 行、下轮收敛。
		res := r.db.Model(&models.AlertEvent{}).
			Where("id = ? AND status = ?", ev.ID, ev.Status).
			Updates(map[string]interface{}{
				"status":     desired,
				"updated_at": now,
			})
		if res.Error != nil {
			return summary, fmt.Errorf("align alert event %d: %w", ev.ID, res.Error)
		}
		if res.RowsAffected > 0 {
			summary.Aligned++
		} else {
			summary.Skipped++
		}
	}

	// 收集待关闭行：未结、且已不在活跃集；只有 AM 稳定且过了宽限期才进入候选。
	var candidates []closeCandidate
	for occurrenceKey, ev := range openByOccurrence {
		if _, ok := activeByOccurrence[occurrenceKey]; ok {
			continue
		}
		if !canClose || now.Sub(ev.CreatedAt) < closeGrace {
			summary.Skipped++
			continue
		}
		if _, young := youngFingerprints[ev.Fingerprint]; young {
			summary.Skipped++
			continue
		}
		target := models.AlertEventStatusLost
		switch ev.Status {
		case models.AlertEventStatusSilenced:
			target = models.AlertEventStatusSilencedClosed
		case models.AlertEventStatusInhibited:
			target = models.AlertEventStatusInhibitedClosed
		}
		candidates = append(candidates, closeCandidate{event: ev, target: target})
	}

	if r.mayClose(len(activeByOccurrence), len(openByOccurrence), len(candidates)) {
		for _, c := range candidates {
			res := r.db.Model(&models.AlertEvent{}).
				Where("id = ? AND status = ?", c.event.ID, c.event.Status).
				Updates(map[string]interface{}{
					"status":     c.target,
					"closed_at":  now,
					"ends_at":    nil,
					"updated_at": now,
				})
			if res.Error != nil {
				return summary, fmt.Errorf("close alert event %d: %w", c.event.ID, res.Error)
			}
			if res.RowsAffected > 0 {
				summary.Closed++
			} else {
				summary.Skipped++
			}
		}
	} else {
		summary.Skipped += len(candidates)
	}

	// 活跃集中有、库里没有未结行的：先尝试恢复被对账误关的原行，再决定是否补插。
	for occurrenceKey, a := range activeByOccurrence {
		if _, ok := stillOpen[occurrenceKey]; ok {
			continue
		}
		startsAt := a.StartsAt
		if startsAt.IsZero() {
			startsAt = now
		}
		startsAt = models.NormalizeAlertEventTime(startsAt)

		var ev models.AlertEvent
		hit, err := findByOccurrenceKey(r.db, occurrenceKey, &ev)
		if err != nil {
			return summary, fmt.Errorf("load alert occurrence %q: %w", occurrenceKey, err)
		}
		if hit {
			if models.IsOpenAlertEventStatus(ev.Status) {
				continue
			}
			if !models.IsInferredAlertEventStatus(ev.Status) {
				// 已真实恢复的发生不复活，也不为其另插新行。
				summary.Skipped++
				continue
			}
			desired := activeAlertStatus(a)
			res := r.db.Model(&models.AlertEvent{}).
				Where("id = ? AND status = ?", ev.ID, ev.Status).
				Updates(map[string]interface{}{
					"status":     desired,
					"closed_at":  nil,
					"ends_at":    nil,
					"updated_at": now,
				})
			if res.Error != nil {
				return summary, fmt.Errorf("restore alert event %d: %w", ev.ID, res.Error)
			}
			if res.RowsAffected > 0 {
				summary.Restored++
			} else {
				summary.Skipped++
			}
			continue
		}

		// 补插只补 state=active 的漏记：首次触发就被静默/抑制，或尚未确定通知状态的不补。
		if a.State != "active" {
			summary.Skipped++
			continue
		}
		if now.Sub(startsAt) < closeGrace {
			summary.Skipped++ // 刚诞生，webhook 可能还在路上
			continue
		}
		ev = buildReconcileEvent(a, startsAt, now)
		if err := r.db.Create(&ev).Error; err != nil {
			if isUniqueViolation(err) {
				summary.Skipped++
				continue
			}
			return summary, fmt.Errorf("backfill alert event %q: %w", occurrenceKey, err)
		}
		summary.Backfilled++
	}
	return summary, nil
}

// mayClose 执行关闭安全阀：活跃集连续为空、单轮关闭比例异常时先缓一轮。
func (r *Reconciler) mayClose(activeCount, totalOpen, candidateCount int) bool {
	// 空活跃集：连续 confirmRounds 轮完整拉取为空后才允许关行。
	if activeCount == 0 {
		r.emptyRounds++
		if r.emptyRounds < confirmRounds {
			log.Printf("[alert-history] reconcile active set empty (%d/%d rounds), skip closing",
				r.emptyRounds, confirmRounds)
			return false
		}
	} else {
		r.emptyRounds = 0
	}

	// 单轮关闭比例异常：先缓一轮，下一轮仍满足才执行。
	if candidateCount > closeRatioMinRows && totalOpen > 0 &&
		float64(candidateCount)/float64(totalOpen) > closeRatioThreshold {
		r.suspiciousRounds++
		if r.suspiciousRounds < confirmRounds {
			log.Printf("[alert-history] reconcile suspicious close ratio %d/%d (%d/%d rounds), skip closing",
				candidateCount, totalOpen, r.suspiciousRounds, confirmRounds)
			return false
		}
		r.suspiciousRounds = 0
		return true
	}
	r.suspiciousRounds = 0
	return true
}

// alertEventOccurrenceKey 返回历史行的对账键；旧数据缺冗余 key 时由指纹和开始时间重建。
func alertEventOccurrenceKey(ev *models.AlertEvent) string {
	if ev == nil {
		return ""
	}
	if ev.OccurrenceKey != "" {
		return ev.OccurrenceKey
	}
	if ev.StartsAt == nil {
		return ""
	}
	return models.AlertEventOccurrenceKey(ev.Fingerprint, models.NormalizeAlertEventTime(*ev.StartsAt))
}

// activeAlertStatus 由 AM 实况计算目标状态：静默/时间静音优先于抑制，其余为告警中。
// unprocessed 也按告警中处理（尚未算完通知状态，但不是被静默/抑制）。
func activeAlertStatus(a ActiveAlert) models.AlertEventStatus {
	if len(a.SilencedBy) > 0 || len(a.MutedBy) > 0 {
		return models.AlertEventStatusSilenced
	}
	if len(a.InhibitedBy) > 0 {
		return models.AlertEventStatusInhibited
	}
	return models.AlertEventStatusFiring
}

// buildReconcileEvent 由实况构造补插行（仅 state=active 的漏记；无真实恢复时间）。
func buildReconcileEvent(a ActiveAlert, startsAt, now time.Time) models.AlertEvent {
	labels := a.Labels
	if labels == nil {
		labels = map[string]string{}
	}
	annotations := a.Annotations
	if annotations == nil {
		annotations = map[string]string{}
	}
	labelsJSON, _ := json.Marshal(labels)
	annotationsJSON, _ := json.Marshal(annotations)
	alertName := labels["alertname"]
	if alertName == "" {
		alertName = alertNamePlaceholder
	}
	startsAt = models.NormalizeAlertEventTime(startsAt)
	return models.AlertEvent{
		BaseModel: models.BaseModel{
			CreatedAt: now,
			UpdatedAt: now,
		},
		Fingerprint:   a.Fingerprint,
		OccurrenceKey: models.AlertEventOccurrenceKey(a.Fingerprint, startsAt),
		AlertName:     truncateRunes(alertName, 200),
		Status:        models.AlertEventStatusFiring,
		Severity:      truncateRunes(labels["severity"], 20),
		Summary:       truncateRunes(annotations["summary"], 500),
		Description:   annotations["description"],
		NetworkDomain: models.ResolveNetworkDomain(labels),
		Labels:        string(labelsJSON),
		Annotations:   string(annotationsJSON),
		StartsAt:      &startsAt,
		Source:        sourceReconcile,
	}
}
