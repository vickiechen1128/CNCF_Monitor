// Package change implements Module_09 §3.3.3「30s 自动变更检测」的轮询运行时：
// 以 DB 持久化基线判定源数据是否推进，进而触发配置草稿生成（方案 A，闭环补缺）。
//
// 设计要点（对齐决策 42-1 / 42-4）：
//   - 基线落库（config_change_baselines）：从 DB 派生而非内存态取最新草稿/已确认版本
//     metadata 的 SourceDataVersion，保证服务重启不误判、首启不对全部网域误生成噪声草稿；
//   - 检测只做「要不要生成」的裁决，生成动作复用 draft.GenerateDraft（保活、校验、
//     checksum 均已内聚），不与手动 POST 另起一套；
//   - 生成失败仅记录可观测状态（DetectStatus=failed + LastError + 日志），不推进版本，
//     下一轮重试（决策 42-4）；
//   - 已有活 pending 时跳过本轮（draft.LatestLivePending 复用保活口径），不重复生成。
package change

import (
	"context"
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

// Start 在独立 goroutine 中按 interval 启动全量域变更检测轮询。
// 随 ctx 取消优雅退出；同一进程内循环为串行执行（一次只处理一轮），
// 因此多轮次不会重叠；与手动 POST 的竞态由 GenerateDraft 保活约束兜底。
func Start(ctx context.Context, db *gorm.DB, interval time.Duration) {
	if db == nil {
		log.Printf("%s db is nil, watcher disabled", detectLogPrefix)
		return
	}
	go func() {
		log.Printf("%s started, interval=%s", detectLogPrefix, interval)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		// 首轮睡满一个间隔再跑：给服务启动/DB 就绪留出窗口，首启只做基线初始化，
		// 不会对全部网域误生成噪声草稿。
		select {
		case <-ctx.Done():
			log.Printf("%s stopped before first pass", detectLogPrefix)
			return
		case <-ticker.C:
		}

		for {
			passStart := time.Now()
			if err := runDetectionPass(db); err != nil {
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
func runDetectionPass(db *gorm.DB) error {
	var domains []models.NetworkDomain
	if err := db.
		Where("is_monitored = ? AND status = ?", true, models.DomainStatusEnabled).
		Find(&domains).Error; err != nil {
		return err
	}
	for i := range domains {
		if err := ProcessDomain(db, domains[i].ID); err != nil {
			log.Printf("%s domain=%s detect error: %v", detectLogPrefix, domains[i].ID, err)
		}
	}
	return nil
}

// ProcessDomain 对单个网域执行一轮变更检测（单测可直接调用）：
//
//  1. 聚合当前源数据版本；
//  2. 无基线记录（首启）→ 初始化基线=当前版本并跳过本轮，不误生成；
//  3. 版本未推进 → 跳过；
//  4. 版本推进但已有活 pending → 跳过（等用户处理，保活不重复）；
//  5. 否则复用 GenerateDraft 生成草稿；成功推进基线，失败记录可观测状态不推进。
func ProcessDomain(db *gorm.DB, domainID string) error {
	current, err := generator.SourceDataVersion(db, domainID)
	if err != nil {
		return recordDetectFailed(db, domainID, "aggregate_source_version", err)
	}

	baseline, err := loadBaseline(db, domainID)
	if err != nil {
		return err
	}
	now := time.Now()
	if baseline == nil {
		// 首启：仅初始化基线，不触发生成。
		return upsertBaseline(db, domainID, current, models.DetectStatusIdle, "", now)
	}

	if !generator.NeedsRegeneration(baseline.SourceVersion, current) {
		return upsertBaseline(db, domainID, current, models.DetectStatusIdle, "", now)
	}

	// 已有活 pending：跳过该域，等用户确认/废弃后再检测（不重复生成）。
	live, err := draft.LatestLivePending(db, domainID)
	if err != nil {
		return recordDetectFailed(db, domainID, "check_live_pending", err)
	}
	if live != nil {
		return upsertBaseline(db, domainID, current, models.DetectStatusSkippedPending, "", now)
	}

	if _, err := draft.GenerateDraft(db, domainID); err != nil {
		// 决策 42-4：生成失败仅记录状态、不推进基线版本，下轮重试。
		return recordDetectFailed(db, domainID, "generate", err)
	}
	return upsertBaseline(db, domainID, current, models.DetectStatusGenerated, "", now)
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
func upsertBaseline(db *gorm.DB, domainID, sourceVersion string, status models.ChangeDetectStatus, lastErr string, checkedAt time.Time) error {
	var b models.ConfigChangeBaseline
	if err := db.Where(&models.ConfigChangeBaseline{NetworkDomainID: domainID}).Attrs(models.ConfigChangeBaseline{
		SourceVersion: sourceVersion,
		DetectStatus:  status,
		LastError:     lastErr,
		LastCheckedAt: &checkedAt,
	}).FirstOrInit(&b).Error; err != nil {
		return err
	}
	b.NetworkDomainID = domainID
	b.SourceVersion = sourceVersion
	b.DetectStatus = status
	b.LastError = lastErr
	b.LastCheckedAt = &checkedAt
	if err := db.Save(&b).Error; err != nil {
		return err
	}
	log.Printf("%s domain=%s status=%s version=%s", detectLogPrefix, domainID, status, sourceVersion)
	return nil
}

// recordDetectFailed 将一次失败记录为可观测状态并返回 error（供上层日志与调用方处理）。
// 失败时不推进基线流档版本（决策 42-4）：保留原 SourceVersion 作 prev，下一轮重试；
// 记录 DetectStatus=failed + LastError 供日志与运维排查。
func recordDetectFailed(db *gorm.DB, domainID, stage string, cause error) error {
	now := time.Now()
	src := ""
	if b, err := loadBaseline(db, domainID); err == nil && b != nil {
		src = b.SourceVersion
	}
	if err := upsertBaseline(db, domainID, src, models.DetectStatusFailed, stage+": "+cause.Error(), now); err != nil {
		return err
	}
	return cause
}