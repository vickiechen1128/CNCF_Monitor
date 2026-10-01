package models

import (
	"errors"

	"gorm.io/gorm"
)

// ErrPrimaryPlatformExists 表示应用已经绑定主平台。
var ErrPrimaryPlatformExists = errors.New("应用已存在主平台")

// AppPlatformRel 承载应用与平台的多对多关系。同一应用可关联多个平台，
// 但至多一个关联可标记为主平台。
type AppPlatformRel struct {
	BaseModel
	AppCode      string `gorm:"size:64;not null;uniqueIndex:idx_app_platform_rel_app_platform,priority:1" json:"app_code"`
	PlatformCode string `gorm:"size:64;not null;uniqueIndex:idx_app_platform_rel_app_platform,priority:2" json:"platform_code"`
	IsPrimary    bool   `gorm:"not null;default:false" json:"is_primary"`
}

// ValidateAppPlatformPrimaryUnique 在调用方事务内校验同一应用至多一个主平台。
// excludeRelID 用于更新现有关联时排除自身；创建时传 0。
func ValidateAppPlatformPrimaryUnique(tx *gorm.DB, appCode string, excludeRelID uint) error {
	query := tx.Model(&AppPlatformRel{}).
		Where("app_code = ? AND is_primary = ?", appCode, true)
	if excludeRelID != 0 {
		query = query.Where("id <> ?", excludeRelID)
	}

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrPrimaryPlatformExists
	}
	return nil
}
