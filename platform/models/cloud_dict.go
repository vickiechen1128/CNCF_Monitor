package models

// CloudType 是云字典的云类型描述属性，不作为独立资源字段或标签维度。
type CloudType string

const (
	CloudTypePublic     CloudType = "PUB"
	CloudTypeGovernment CloudType = "GM"
	CloudTypeIndustry   CloudType = "IND"
	CloudTypePrivate    CloudType = "PRI"
)

// CloudCarrier 是云字典的云载体描述属性，不作为独立资源字段或标签维度。
type CloudCarrier string

const (
	CloudCarrierTencent CloudCarrier = "TX"
	CloudCarrierUnicom  CloudCarrier = "CU"
	CloudCarrierMobile  CloudCarrier = "CM"
)

// CloudDict 是部署级只读云字典。CloudCode 是不可变的复合编码，资源与 cloud
// label 仅引用该编码；CloudType 和 Carrier 只用于描述条目。
type CloudDict struct {
	BaseModel
	CloudCode   string       `gorm:"size:50;not null;uniqueIndex:idx_cloud_dict_code" json:"cloud_code"`
	CloudName   string       `gorm:"size:100;not null" json:"cloud_name"`
	CloudType   CloudType    `gorm:"size:10;not null" json:"cloud_type"`
	Carrier     CloudCarrier `gorm:"size:10;not null" json:"carrier"`
	Enabled     bool         `gorm:"not null" json:"enabled"`
	Description string       `gorm:"size:500" json:"description"`
}
