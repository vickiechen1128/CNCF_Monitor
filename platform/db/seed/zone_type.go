package seed

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runZoneTypes seeds the deployment-level zone_type dictionary. Per the Module_06
// acceptance baseline only two entries are enabled (政务外网区/互联网区); the
// legacy 专线区/DMZ区 entries are kept but disabled so the dictionary no longer
// defaults every zone on.
func runZoneTypes(db *gorm.DB) error {
	seed := []models.ZoneType{
		{Code: string(models.ZoneTypeInternet), DisplayName: "互联网区", Description: "政务云互联网区", Enabled: true},
		{Code: string(models.ZoneTypeExtranet), DisplayName: "政务外网区", Description: "政务外网区", Enabled: true},
		{Code: string(models.ZoneTypePrivateLine), DisplayName: "专线区", Description: "专线区", Enabled: false},
		{Code: string(models.ZoneTypeDMZ), DisplayName: "DMZ区", Description: "DMZ 区", Enabled: false},
	}
	for i := range seed {
		item := &seed[i]
		var existing models.ZoneType
		err := db.Where("code = ?", item.Code).First(&existing).Error
		switch err {
		case nil:
			// 已存在：idempotently 对齐显示名 / 启用态（存量库首次运行会修正启用开关）
			existing.DisplayName = item.DisplayName
			existing.Description = item.Description
			existing.Enabled = item.Enabled
			if err := db.Save(&existing).Error; err != nil {
				return err
			}
		case gorm.ErrRecordNotFound:
			if err := db.Create(item).Error; err != nil {
				return err
			}
		default:
			return err
		}
	}
	return nil
}