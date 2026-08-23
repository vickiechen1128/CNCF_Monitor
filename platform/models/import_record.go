package models

// ImportMode represents the behavior mode of a resource import run,
// aligned with Module_07 §5.16.2.
type ImportMode string

// Import mode constants.
const (
	ImportModeCreateOnly ImportMode = "create_only"
	ImportModeUpsert     ImportMode = "upsert"
)

// ImportStatus represents the overall outcome of an import run,
// aligned with Module_07 §6.4.
type ImportStatus string

// Import status constants.
const (
	ImportStatusSuccess ImportStatus = "success"
	ImportStatusPartial ImportStatus = "partial"
	ImportStatusFailed  ImportStatus = "failed"
)

// ImportErrorDetail describes a single row-level error captured during import,
// aligned with Module_07 §5.16.3 (row / resource_category / field / value / reason).
type ImportErrorDetail struct {
	Row              int    `json:"row"` // 从 2 起始（表头后第一行）
	ResourceCategory string `json:"resource_category"`
	Field            string `json:"field"`
	Value            string `json:"value"`
	Reason           string `json:"reason"`
}

// ImportRecord keeps an append-only audit record for one import run, aligned
// with Module_07 §6.4. The operator is fixed to platform_admin in MVP.
type ImportRecord struct {
	BaseModel
	ImportNo         string              `gorm:"size:64;uniqueIndex:idx_import_record_no" json:"import_no"`
	ResourceCategory ResourceCategory    `gorm:"size:30;not null;index" json:"resource_category"`
	Mode             ImportMode          `gorm:"size:20;not null" json:"mode"`
	Total            int                 `json:"total"`
	Success          int                 `json:"success"`
	Updated          int                 `json:"updated"` // upsert 命中判重键被覆盖更新的行数（create_only 无此字段）
	Failed           int                 `json:"failed"`
	Status           ImportStatus        `gorm:"size:20;not null;index" json:"status"`
	Errors           []ImportErrorDetail `gorm:"serializer:json" json:"errors"`
	Operator         string              `gorm:"size:64;not null" json:"operator"` // MVP 固定 platform_admin
}
