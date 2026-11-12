package scrapejob

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// resolveJobNameConflict 判定 job_name 是否已被其它存活 Job 占用，并在同名行仅为
// 软删残留时物理清理、释放唯一索引（与创建同名 Job 的口径一致）。
//
// 大小写不敏感：targets 文件名直接使用 job_name，而 Windows 文件系统不区分大小写，
// Host / host 会落到同一个 <name>.json；在 Linux 上虽可共存，但为避免跨平台行为
// 不一致，统一按不区分大小写判重。excludeID != 0 时排除自身（更新/改名场景）。
//
// 返回 taken=true 表示存在同名的存活 Job。
func resolveJobNameConflict(db *gorm.DB, name string, excludeID uint) (bool, error) {
	var active models.ScrapeJob
	err := db.Where("LOWER(job_name) = LOWER(?)", name).First(&active).Error
	switch {
	case err == nil:
		if excludeID != 0 && active.ID == excludeID {
			return false, nil
		}
		return true, nil
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return false, fmt.Errorf("check duplicate scrape job: %w", err)
	}

	// 同名行只剩软删残留：物理清理以释放唯一索引，允许用户重建同名 Job。
	if err := db.Unscoped().
		Where("LOWER(job_name) = LOWER(?)", name).
		Delete(&models.ScrapeJob{}).Error; err != nil {
		return false, fmt.Errorf("purge soft-deleted scrape job %q: %w", name, err)
	}
	return false, nil
}
