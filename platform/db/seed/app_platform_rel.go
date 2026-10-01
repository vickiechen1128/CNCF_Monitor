package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runAppPlatformBackfill 将应用字典遗留的单值 PlatformCode（决策 111 之前：每个应用
// 至多关联一个平台、且即为主平台）一次性迁移到新的 M:N 关系表 AppPlatformRel。
//
// 设计要点：
//   - 幂等：已存在对应 (app_code, platform_code) 关联时跳过，重复 Run 不产生重复行；
//   - 仅当平台字典仍存在该 platform_code 时才建关联，避免悬空关联；
//   - 仅当应用尚无主平台时把遗留单值平台置为主平台（决策 111：同一应用至多一个主平台）；
//   - 不清理应用字典遗留字段，仅作只读来源（模型注释已声明该字段废弃）。
func runAppPlatformBackfill(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("backfill app-platform: nil database connection")
	}
	if !db.Migrator().HasTable(&models.AppPlatformRel{}) || !db.Migrator().HasTable(&models.ApplicationDict{}) {
		return nil // 目标表未建（部分迁移 / 最小化固件）→ 跳过，不阻断启动
	}

	// 收集现存平台编码，过滤已不存在的历史平台。
	var platforms []models.PlatformDict
	if err := db.Find(&platforms).Error; err != nil {
		return fmt.Errorf("backfill app-platform: load platforms: %w", err)
	}
	platformSet := make(map[string]bool, len(platforms))
	for _, p := range platforms {
		platformSet[p.PlatformCode] = true
	}

	// 仅迁移仍携带遗留 PlatformCode 且非空的存量应用。
	var apps []models.ApplicationDict
	if err := db.Where("platform_code <> ?", "").Find(&apps).Error; err != nil {
		return fmt.Errorf("backfill app-platform: load application dict: %w", err)
	}

	for _, app := range apps {
		if app.PlatformCode == "" || !platformSet[app.PlatformCode] {
			continue
		}
		var relCount int64
		if err := db.Model(&models.AppPlatformRel{}).
			Where("app_code = ? AND platform_code = ?", app.AppCode, app.PlatformCode).
			Count(&relCount).Error; err != nil {
			return fmt.Errorf("backfill app-platform: check rel %s/%s: %w", app.AppCode, app.PlatformCode, err)
		}
		if relCount > 0 {
			continue // 已迁移，跳过（幂等）
		}
		// 若应用尚无主平台，则把遗留单值平台置为主平台。
		var primaryCount int64
		if err := db.Model(&models.AppPlatformRel{}).
			Where("app_code = ? AND is_primary = ?", app.AppCode, true).
			Count(&primaryCount).Error; err != nil {
			return fmt.Errorf("backfill app-platform: check primary %s: %w", app.AppCode, err)
		}
		rel := models.AppPlatformRel{
			AppCode:      app.AppCode,
			PlatformCode: app.PlatformCode,
			IsPrimary:    primaryCount == 0,
		}
		if err := db.Create(&rel).Error; err != nil {
			return fmt.Errorf("backfill app-platform: create rel %s/%s: %w", app.AppCode, app.PlatformCode, err)
		}
	}
	return nil
}
