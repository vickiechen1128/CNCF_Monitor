package models

// ZoneTypeCode holds the deployment-level network zone type codes.
type ZoneTypeCode string

// Preset zone type codes for government cloud (政务云); public cloud uses
// region semantics (e.g. cn-hangzhou), see Module_06 §3.2/§5.
const (
	ZoneTypeInternet    ZoneTypeCode = "internet"
	ZoneTypeExtranet    ZoneTypeCode = "extranet"
	ZoneTypePrivateLine ZoneTypeCode = "private-line"
	ZoneTypeDMZ         ZoneTypeCode = "dmz"
)

// ZoneType is a deployment-level read-only network zone type dictionary entry,
// aligned with Module_06 §5.1/§3.2.
type ZoneType struct {
	BaseModel
	Code        string `gorm:"size:50;uniqueIndex;not null" json:"code"`
	DisplayName string `gorm:"size:100;not null" json:"display_name"`
	Description string `gorm:"size:500" json:"description"`
	Enabled     bool   `json:"enabled"`
}