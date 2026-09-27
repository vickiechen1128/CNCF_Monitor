package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runCloudDicts 幂等登记部署级只读云字典，并按 cloud_code 对齐权威预置属性。
func runCloudDicts(db *gorm.DB) error {
	entries := []models.CloudDict{
		{
			CloudCode: "PUB-TX",
			CloudName: "腾讯云",
			CloudType: models.CloudTypePublic,
			Carrier:   models.CloudCarrierTencent,
			Enabled:   true,
		},
		{
			CloudCode:   "GM-CU",
			CloudName:   "政务云（联通）",
			CloudType:   models.CloudTypeGovernment,
			Carrier:     models.CloudCarrierUnicom,
			Enabled:     true,
			Description: "规划中",
		},
	}

	for i := range entries {
		entry := &entries[i]
		var existing models.CloudDict
		err := db.Where("cloud_code = ?", entry.CloudCode).First(&existing).Error
		switch err {
		case nil:
			existing.CloudName = entry.CloudName
			existing.CloudType = entry.CloudType
			existing.Carrier = entry.Carrier
			existing.Enabled = entry.Enabled
			existing.Description = entry.Description
			if err := db.Save(&existing).Error; err != nil {
				return fmt.Errorf("seed cloud dict %q: %w", entry.CloudCode, err)
			}
		case gorm.ErrRecordNotFound:
			if err := db.Create(entry).Error; err != nil {
				return fmt.Errorf("seed cloud dict %q: %w", entry.CloudCode, err)
			}
		default:
			return fmt.Errorf("seed cloud dict %q: %w", entry.CloudCode, err)
		}
	}
	return nil
}
