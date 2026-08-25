// Package change implements Module_09 §3.3.3「自动变更检测」的运行时：
// 以 DB 持久化基线判定源数据是否推进，进而触发配置草稿生成（方案 A，闭环补缺）。
//
// 设计要点（对齐决策 42-1 / 42-4）：
//   - 基线落库（config_change_baselines）：从 DB 派生而非内存态取最新草稿/已确认版本
//     metadata 的 SourceDataVersion 作 prev：保证服务重启不误判；首启不对全部网域误生成噪声草稿；
//   - 检测只做「要不要生成」的裁决，生成动作复用 draft.GenerateDraft（保活、校验、
//     checksum 均已内聚），不与手动 POST 另起一套；
//   - 生成失败仅记录可观测状态（DetectStatus=failed + LastError + 日志），不推进版本，
//     下一轮重试（决策 42-4）；
//   - 已有活 pending 时比较当前产物 checksum 与 pending 的 checksum，不同则生成新 pending
//     取代旧单（决策 44-2），相同才跳过本轮；
//   - 自适应退避：近期有变更时间隔缩至 minInterval，长期无变化指数退避至 maxInterval。
package change

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 检测状态（决策 42-4 可观测）。
const (
	detectLogPrefix = "[change-detect]"
)

var (
	// 默认最小/最大检测间隔；Start 参数可覆盖。
	defaultMinInterval = 5 * time.Second
	defaultMaxInterval = 120 * time.Second
)

// Start 在独立 goroutine 中启动全量域变更检测轮询。
// 主循环以 minInterval 为 tick，但每个网域是否实际执行检测取决于其 NextCheckAt。
// 随 ctx 取消优雅退出；同一进程内循环为串行执行（一次只处理一轮），
// 因此多轮次不会重叠；与手动 POST 的竞态由 GenerateDraft 保活约束兜底。
func Start(ctx context.Context, db *gorm.DB, minInterval, maxInterval time.Duration) {
	if db == nil {
		log.Printf("%s db is nil, watcher disabled", detectLogPrefix)
		return
	}
	if minInterval <= 0 {
		minInterval = defaultMinInterval
	}
	if maxInterval <= 0 {
		maxInterval = defaultMaxInterval
	}
	if maxInterval < minInterval {
		maxInterval = minInterval
	}

	go func() {
		log.Printf("%s started, minInterval=%s maxInterval=%s", detectLogPrefix, minInterval, maxInterval)
		ticker := time.NewTicker(minInterval)
		defer ticker.Stop()

		// 首轮等待一个最小间隔：给服务启动/DB 就绪留出窗口，首启只做基线初始化。
		select {
		case <-ctx.Done():
			log.Printf("%s stopped before first pass", detectLogPrefix)
			return
		case <-ticker.C:
		}

		for {
			passStart := time.Now()
			if err := runDetectionPass(db, minInterval, maxInterval); err != nil {
				log.Printf("%s pass error: %v", detectLogPrefix, err)
			} else {
				log.Printf("%s pass done in %s", detectLogPrefix, time.Since(passStart).Round(time.Millisecond))
			}
			select {
			case <-ctx.Done():
				log.Printf("%s stopped gracefully", detectLogPrefix)
				return
			case <-ticker.C:
			}
		}
	}()
}

// runDetectionPass 遍历全部已纳管且非冻结的网域，逐域执行一轮变更检测。
// 单域失败被记录（ProcessDomain 内落库+日志）但不阻断其他域。
func runDetectionPass(db *gorm.DB, minInterval, maxInterval time.Duration) error {
	var domains []models.NetworkDomain
	if err := db.
		Where("is_monitored = ? AND status = ?", true, models.DomainStatusEnabled).
		Find(&domains).Error; err != nil {
		return err
	}
	for i := range domains {
		if err := ProcessDomainWithIntervals(db, domains[i].ID, minInterval, maxInterval); err != nil {
			log.Printf("%s domain=%s detect error: %v", detectLogPrefix, domains[i].ID, err)
		}
	}
	return nil
}

// ProcessDomain 对单个网域执行一轮变更检测（默认间隔，供外部单测兼容）。
func ProcessDomain(db *gorm.DB, domainID string) error {
	return ProcessDomainWithIntervals(db, domainID, defaultMinInterval, defaultMaxInterval)
}

// ProcessDomainWithIntervals 对单个网域执行一轮变更检测（单测可直接调用）：
//
//  1. 聚合当前源数据版本；
//  2. 无基线记录（首启）→ 初始化基线=当前版本并跳过本轮，不误生成；
//  3. 未到 NextCheckAt → 跳过；
//  4. 版本未推进 → 跳过并按退避策略延长间隔；
//  5. 版本推进但已有活 pending → 跳过（等用户处理，保活不重复），间隔缩至最小；
//  6. 否则复用 GenerateDraft 生成草稿；成功推进基线并重置间隔，失败记录可观测状态不推进。
func ProcessDomainWithIntervals(db *gorm.DB, domainID string, minInterval, maxInterval time.Duration) error {
	current, err := generator.SourceDataVersion(db, domainID)
	if err != nil {
		return recordDetectFailed(db, domainID, "aggregate_source_version", err, minInterval, maxInterval)
	}

	baseline, err := loadBaseline(db, domainID)
	if err != nil {
		return err
	}
	now := time.Now()
	if baseline == nil {
		// 首启：仅初始化基线，不触发生成；间隔从最小开始。
		nextCheck := now.Add(minInterval)
		return upsertBaseline(db, domainID, current, models.DetectStatusIdle, "", now,
			int(minInterval.Seconds()), 0, nextCheck)
	}

	// 旧数据兼容 / 异常兜底：未设置 IntervalSeconds 或 NextCheckAt 时按最小间隔立即检测。
	if baseline.IntervalSeconds <= 0 || baseline.NextCheckAt == nil || baseline.NextCheckAt.IsZero() {
		baseline.IntervalSeconds = int(minInterval.Seconds())
		baseline.NextCheckAt = &now
	}

	if now.Before(*baseline.NextCheckAt) {
		// 未到该域的下次检测时间，本轮跳过。
		return nil
	}

	if !generator.NeedsRegeneration(baseline.SourceVersion, current) {
		// 源数据未变化：指数退避，间隔翻倍，上限 maxInterval。
		backoff := baseline.BackoffLevel + 1
		newInterval := minInterval * (1 << backoff)
		if newInterval > maxInterval {
			newInterval = maxInterval
			backoff = baseline.BackoffLevel // 到达上限后保持当前 backoff
		}
		nextCheck := now.Add(newInterval)
		return upsertBaseline(db, domainID, baseline.SourceVersion, models.DetectStatusIdle, "", now,
			int(newInterval.Seconds()), backoff, nextCheck)
	}

	// 已有活 pending：不直接跳过，先比较当前产物 checksum 与 pending 的 checksum（决策 44-2）。
	// 若产物已变化（如批量生效后 draft→ready），生成新 pending 取代旧单；
	// 若产物无变化，保持跳过并等用户处理。
	live, err := draft.LatestLivePending(db, domainID)
	if err != nil {
		return recordDetectFailed(db, domainID, "check_live_pending", err, minInterval, maxInterval)
	}
	if live != nil {
		dom, dErr := generator.LoadDomain(db, domainID)
		if dErr != nil {
			return recordDetectFailed(db, domainID, "load_domain_for_compare", dErr, minInterval, maxInterval)
		}
		supersede, sErr := draft.ShouldSupersedePending(db, dom, live)
		if sErr != nil {
			return recordDetectFailed(db, domainID, "compare_pending_checksum", sErr, minInterval, maxInterval)
		}
		if supersede {
			if _, err := draft.GenerateDraft(db, domainID); err != nil {
				if errors.Is(err, draft.ErrNoChanges) {
					// 无实质变更：推进基线，不生成草稿（决策 44-3）。
					nextCheck := now.Add(minInterval)
					return upsertBaseline(db, domainID, current, models.DetectStatusIdle, "", now,
						int(minInterval.Seconds()), 0, nextCheck)
				}
				return recordDetectFailed(db, domainID, "generate_supersede", err, minInterval, maxInterval)
			}
			nextCheck := now.Add(minInterval)
			return upsertBaseline(db, domainID, current, models.DetectStatusGenerated, "", now,
				int(minInterval.Seconds()), 0, nextCheck)
		}
		nextCheck := now.Add(minInterval)
		return upsertBaseline(db, domainID, baseline.SourceVersion, models.DetectStatusSkippedPending, "", now,
			int(minInterval.Seconds()), 0, nextCheck)
	}

	if _, err := draft.GenerateDraft(db, domainID); err != nil {
		if errors.Is(err, draft.ErrNoChanges) {
			// 无实质变更：推进基线，不生成草稿（决策 44-3）。
			nextCheck := now.Add(minInterval)
			return upsertBaseline(db, domainID, current, models.DetectStatusIdle, "", now,
				int(minInterval.Seconds()), 0, nextCheck)
		}
		// 决策 42-4：生成失败仅记录状态、不推进基线版本，下轮重试；间隔保持最小便于快速重试。
		return recordDetectFailed(db, domainID, "generate", err, minInterval, maxInterval)
	}
	nextCheck := now.Add(minInterval)
	return upsertBaseline(db, domainID, current, models.DetectStatusGenerated, "", now,
		int(minInterval.Seconds()), 0, nextCheck)
}

func loadBaseline(db *gorm.DB, domainID string) (*models.ConfigChangeBaseline, error) {
	var b models.ConfigChangeBaseline
	err := db.Where("network_domain_id = ?", domainID).First(&b).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// upsertBaseline 写入/更新某域基线（首启初始化亦走此分支，FirstOrInit 保证幂等）。
// 注意：FirstOrInit 的字符串 where 条件不会赋回结构体，故 NetworkDomainID 需显式赋值。
func upsertBaseline(
	db *gorm.DB,
	domainID, sourceVersion string,
	status models.ChangeDetectStatus,
	lastErr string,
	checkedAt time.Time,
	intervalSeconds, backoffLevel int,
	nextCheckAt time.Time,
) error {
	var b models.ConfigChangeBaseline
	if err := db.Where(&models.ConfigChangeBaseline{NetworkDomainID: domainID}).Attrs(models.ConfigChangeBaseline{
		SourceVersion:   sourceVersion,
		DetectStatus:    status,
		LastError:       lastErr,
		LastCheckedAt:   &checkedAt,
		IntervalSeconds: intervalSeconds,
		BackoffLevel:    backoffLevel,
		NextCheckAt:     &nextCheckAt,
	}).FirstOrInit(&b).Error; err != nil {
		return err
	}
	b.NetworkDomainID = domainID
	b.SourceVersion = sourceVersion
	b.DetectStatus = status
	b.LastError = lastErr
	b.LastCheckedAt = &checkedAt
	b.IntervalSeconds = intervalSeconds
	b.BackoffLevel = backoffLevel
	b.NextCheckAt = &nextCheckAt
	if err := db.Save(&b).Error; err != nil {
		return err
	}
	log.Printf("%s domain=%s status=%s version=%s interval=%ds next_check=%s",
		detectLogPrefix, domainID, status, sourceVersion, intervalSeconds, nextCheckAt.Format(time.RFC3339))
	return nil
}

// recordDetectFailed 将一次失败记录为可观测状态并返回 error（供上层日志与调用方处理）。
// 失败时不推进基线流档版本（决策 42-4）：保留原 SourceVersion 作 prev，下一轮重试；
// 间隔重置为最小，便于快速感知恢复。
func recordDetectFailed(db *gorm.DB, domainID, stage string, cause error, minInterval, maxInterval time.Duration) error {
	now := time.Now()
	src := ""
	backoff := 0
	if b, err := loadBaseline(db, domainID); err == nil && b != nil {
		src = b.SourceVersion
		backoff = b.BackoffLevel
	}
	// 失败时保持当前 backoff 对应的间隔，但上限 maxInterval；若之前未设置则使用最小值。
	interval := minInterval * (1 << backoff)
	if interval > maxInterval {
		interval = maxInterval
	}
	nextCheck := now.Add(interval)
	if err := upsertBaseline(db, domainID, src, models.DetectStatusFailed, stage+": "+cause.Error(), now,
		int(interval.Seconds()), backoff, nextCheck); err != nil {
		return err
	}
	return cause
}
