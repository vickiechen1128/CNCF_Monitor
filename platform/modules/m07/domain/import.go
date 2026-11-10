package domain

import "time"

// ImportMode is the Excel import mode.
type ImportMode string

// Import modes.
const (
	ImportModeCreateOnly ImportMode = "create_only"
	ImportModeUpsert     ImportMode = "upsert"
)

// ImportStatus is the import job status.
type ImportStatus string

// Import statuses.
const (
	ImportStatusSuccess ImportStatus = "success"
	ImportStatusPartial ImportStatus = "partial"
	ImportStatusFailed  ImportStatus = "failed"
)

// ImportErrorDetail is a row-level import error.
type ImportErrorDetail struct {
	Row              int    `json:"row"`
	ResourceCategory string `json:"resource_category"`
	Field            string `json:"field"`
	Value            string `json:"value"`
	Reason           string `json:"reason"`
}

// ImportRecord is an import job record.
type ImportRecord struct {
	ID               string
	ImportNo         string
	ResourceCategory Category
	Mode             ImportMode
	Total            int
	Success          int
	Updated          int
	Failed           int
	Status           ImportStatus
	Errors           []ImportErrorDetail
	Operator         string
	CreatedAt        time.Time
}
