// reconciler.go 实现历史告警的分钟级对账：
//
//	webhook 事件流的盲区 = 被静默/抑制的告警通知被 Alertmanager 吞掉、推送本身可能丢；
//	对账以 Alertmanager 活跃告警全集为准，补齐这三件事：
//	  1. 对齐未结行状态：静默中 / 抑制中 / 告警中（静默优先于抑制）；
//	  2. 补插漏记的行（触发推送曾丢失）——以实况状态直接落库；
//	  3. 关闭已消失的未结行：静默中的标「静默期间结束」，其余标「恢复信息丢失」。
//
// 写入权单一：未结三态互跳只由本任务写（webhook 只插 firing / 回填 resolved）。
// 安全阀：Alertmanager 启动不足 3 分钟时只对齐/补插、不关行（重启后活跃集还在重建）；
// AM 不可达则整轮跳过，绝不误杀。
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
)

// ActiveAlert 是对账所需的 Alertmanager 活跃告警实况（含静默/抑制标记）。
type ActiveAlert struct {
	Fingerprint string
	Labels      map[string]string
	Annotations map[string]string
	StartsAt    time.Time
	EndsAt      time.Time
	State       string
	SilencedBy  []string
	InhibitedBy []string
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
}

// NewReconciler 创建对账任务。
func NewReconciler(db *gorm.DB, source AlertSource) *Reconciler {
	return &Reconciler{db: db, source: source, now: time.Now}
}

// Summary 是一轮对账的结果（仅用于日志观测）。
type Summary struct {
	Aligned    int
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
				log.Printf("[alert-history] reconcile done aligned=%d closed=%d backfilled=%d skipped=%d",
					summary.Aligned, summary.Closed, summary.Backfilled, summary.Skipped)
			}
		}
	}()
}

// RunOnce 执行一轮对账。
func (r *Reconciler) RunOnce(ctx context.Context) (Summary, error) {
	var summary Summary
	if r == nil || r.db == nil || r.source == nil {
		return summary, errors.New("reconciler not initialized")
	}
	now := r.now().UTC()

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

	activeByFingerprint := make(map[string]ActiveAlert, len(active))
	for _, a := range active {
		if a.Fingerprint == "" {
			continue // 无指纹无法与留痕对上，不参与对账
		}
		activeByFingerprint[a.Fingerprint] = a
	}

	var open []models.AlertEvent
	if err := r.db.Where("status IN ?", models.AlertEventOpenStatuses).Find(&open).Error; err != nil {
		return summary, fmt.Errorf("load open alert events: %w", err)
	}

	stillOpen := make(map[string]struct{}, len(open))
	for i := range open {
		ev := &open[i]
		if ev.Fingerprint == "" {
			continue
		}
		stillOpen[ev.Fingerprint] = struct{}{}

		a, exists := activeByFingerprint[ev.Fingerprint]
		if exists {
			desired := activeAlertStatus(a)
			if ev.Status == desired {
				continue
			}
			// CAS：读到的状态仍是原状态才改，撞车时输家命中 0 行、下轮收敛。
			res := r.db.Model(&models.AlertEvent{}).
				Where("id = ? AND status = ?", ev.ID, ev.Status).
				Updates(map[string]interface{}{"status": desired})
			if res.Error != nil {
				return summary, fmt.Errorf("align alert event %d: %w", ev.ID, res.Error)
			}
			if res.RowsAffected > 0 {
				summary.Aligned++
			} else {
				summary.Skipped++
			}
			continue
		}

		// 活跃集中已不存在：只有确认 AM 稳定且该行过了宽限期才关行。
		if !canClose || now.Sub(ev.CreatedAt) < closeGrace {
			summary.Skipped++
			continue
		}
		target := models.AlertEventStatusLost
		if ev.Status == models.AlertEventStatusSilenced {
			// 静默吞掉 resolved 是预期行为，不是平台丢消息。
			target = models.AlertEventStatusSilencedClosed
		}
		res := r.db.Model(&models.AlertEvent{}).
			Where("id = ? AND status = ?", ev.ID, ev.Status).
			Updates(map[string]interface{}{"status": target})
		if res.Error != nil {
			return summary, fmt.Errorf("close alert event %d: %w", ev.ID, res.Error)
		}
		if res.RowsAffected > 0 {
			summary.Closed++
		} else {
			summary.Skipped++
		}
	}

	// 补插漏记：活跃集中有、库里没有未结行的（触发推送曾丢失）。
	for fp, a := range activeByFingerprint {
		if _, ok := stillOpen[fp]; ok {
			continue
		}
		startsAt := a.StartsAt
		if startsAt.IsZero() {
			startsAt = now
		}
		if now.Sub(startsAt) < closeGrace {
			summary.Skipped++ // 刚诞生，webhook 可能还在路上
			continue
		}
		ev := buildReconcileEvent(a, startsAt)
		if err := r.db.Create(ev).Error; err != nil {
			if isUniqueViolation(err) {
				summary.Skipped++
				continue
			}
			return summary, fmt.Errorf("backfill alert event %q: %w", fp, err)
		}
		summary.Backfilled++
	}
	return summary, nil
}

// activeAlertStatus 由 AM 实况计算目标状态：静默优先于抑制，其余为告警中。
// unprocessed 也按告警中处理（尚未算完通知状态，但不是被静默/抑制）。
func activeAlertStatus(a ActiveAlert) models.AlertEventStatus {
	if len(a.SilencedBy) > 0 {
		return models.AlertEventStatusSilenced
	}
	if len(a.InhibitedBy) > 0 {
		return models.AlertEventStatusInhibited
	}
	return models.AlertEventStatusFiring
}

// buildReconcileEvent 由实况构造补插行（无真实恢复时间，ends_at 留空）。
func buildReconcileEvent(a ActiveAlert, startsAt time.Time) *models.AlertEvent {
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
	return &models.AlertEvent{
		Fingerprint:   a.Fingerprint,
		AlertName:     truncateRunes(alertName, 200),
		Status:        activeAlertStatus(a),
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
