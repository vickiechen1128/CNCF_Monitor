package seed

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runZoneTypes seeds the deployment-level zone_type dictionary
// (internet/extranet/private-line/dmz), aligned with Module_06 §3.2/§5.
func runZoneTypes(db *gorm.DB) error {
	seed := []models.ZoneType{
		{Code: string(models.ZoneTypeInternet), DisplayName: "互联网区", Description: "政务云互联网区", Enabled: true},
		{Code: string(models.ZoneTypeExtranet), DisplayName: "政务外网区", Description: "政务外网区", Enabled: true},
		{Code: string(models.ZoneTypePrivateLine), DisplayName: "专线区", Description: "专线区", Enabled: true},
		{Code: string(models.ZoneTypeDMZ), DisplayName: "DMZ区", Description: "DMZ 区", Enabled: true},
	}
	for i := range seed {
		item := &seed[i]
		if err := firstOrCreate(db, item, "code = ?", item.Code); err != nil {
			return err
		}
	}
	return nil
}