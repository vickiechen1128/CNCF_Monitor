package models

// MappingChange records the old and new state of a changed mapping, used by the
// append-only LabelTemplateSnapshot (Module_07 §3.2 / §5.3).
type MappingChange struct {
	TargetLabel string        `json:"target_label"`
	OldValue    *LabelMapping `json:"old_value,omitempty"`
	NewValue    *LabelMapping `json:"new_value,omitempty"`
}

// LabelTemplateSnapshot is a read-only, append-only audit snapshot captured on
// every template / mapping change (operator / time / changed mappings),
// aligned with Module_07 §3.2 / §5.3. MVP only appends records and does NOT
// provide query or rollback APIs.
type LabelTemplateSnapshot struct {
	BaseModel
	TemplateID      uint            `gorm:"not null;index" json:"template_id"`
	Operator        string          `gorm:"size:64;not null" json:"operator"` // MVP 固定 platform_admin
	ChangedMappings []MappingChange `gorm:"serializer:json" json:"changed_mappings"`
}
