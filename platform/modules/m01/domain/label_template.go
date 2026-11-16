package domain

// LabelTemplateRef is the read-only projection of an M07 label template used by
// M01 for display and validation. M01 never writes M07 tables.
type LabelTemplateRef struct {
	ID        string
	Name      string
	Category  string
	IsDefault bool
}
