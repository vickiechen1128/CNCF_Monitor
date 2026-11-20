package domain

import "time"

// SyncState is the M09 synchronisation view embedded in jobs and rules.
//
// M01 owns the columns and writes `pending` on source changes; M09 reports the
// outcome through the SyncResultSink and M01 stores synced/failed.
type SyncState struct {
	Status   SyncStatus
	Version  string
	Error    string
	SyncedAt *time.Time
}

// MappingOverride records a field the user overrode against the mapping
// defaults. Fields listed here are skipped by "sync mapping defaults".
type MappingOverride struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

// ExporterTemplate is one collector implementation in the exporter pool.
type ExporterTemplate struct {
	ID           string
	Name         string
	Version      string
	DefaultPort  int
	MetricsPath  string
	Scheme       Scheme
	OS           string
	Arch         string
	DownloadURL  string
	Homepage     string
	InstallGuide string
	Description  string
	IsBuiltin    bool
	Source       ExporterSource
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Job is a scrape or blackbox job bound to one collection network domain.
type Job struct {
	ID                    string
	JobName               string
	JobType               JobType
	ResourceCategory      ResourceCategory
	TemplateCode          string
	Selector              Selector
	ExporterTemplateID    string
	NetworkDomainID       string
	InstanceSelectionMode InstanceSelectionMode
	SelectedInstanceIDs   []string
	ScrapeInterval        string
	ScrapeTimeout         string
	MetricsPath           string
	Scheme                Scheme
	AuthType              AuthType
	Username              string
	PasswordCipher        string
	TokenCipher           string
	TLSSkipVerify         bool
	CAFile                string
	LabelTemplateID       string
	BlackboxModule        string
	TargetField           string
	MappingOverrides      []MappingOverride
	DraftStatus           DraftStatus
	Enabled               bool
	Sync                  SyncState
	// JobGroupID links a per-domain child job to its monitoring intent
	// (m01_job_groups). Empty for legacy standalone jobs (SRS JG v1.0).
	JobGroupID string
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

// JobGroup is one monitoring intent: a set of common scrape parameters plus the
// child jobs it fans out to, one per network domain (SRS JG v1.0 §3).
//
// The group is the maintenance/display unit only; every child job keeps the
// single-domain invariants M09 relies on. Group-level sync status is derived
// from the children and is never persisted.
type JobGroup struct {
	ID                 string
	Name               string
	JobType            JobType
	ResourceCategory   ResourceCategory
	TemplateCode       string
	Selector           Selector
	ExporterTemplateID string
	ScrapeInterval     string
	ScrapeTimeout      string
	MetricsPath        string
	Scheme             Scheme
	AuthType           AuthType
	Username           string
	PasswordCipher     string
	TokenCipher        string
	TLSSkipVerify      bool
	CAFile             string
	LabelTemplateID    string
	BlackboxModule     string
	TargetField        string
	MappingOverrides   []MappingOverride
	Status             JobGroupStatus
	CreatedBy          string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// Rule is a monitoring rule (alerting / recording). Rules are platform-global
// and evaluated by the center Prometheus (D35/D36).
type Rule struct {
	ID                 string
	Name               string
	ContentMode        RuleContentMode
	RuleContent        string
	RuleType           RuleType
	Expr               string
	Duration           string
	Labels             map[string]string
	Annotations        map[string]string
	TemplateCode       string
	ExporterTemplateID string
	Scope              RuleScope
	Enabled            bool
	DraftStatus        DraftStatus
	AckJobRefErrors    bool
	AckReason          string
	Sync               SyncState
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// MetricAnchor ties a technical metric to a collection template and its source
// exporter (same metric name may carry different meanings per anchor).
type MetricAnchor struct {
	TemplateCode   string `json:"template_code"`
	SourceExporter string `json:"source_exporter,omitempty"`
}

// Metric is one technical metric catalogue entry.
type Metric struct {
	ID                  string
	MetricName          string
	MetricType          MetricType
	Help                string
	Unit                string
	Labels              []string
	CollectionTemplates []MetricAnchor
	Category            string
	ExporterTemplateID  string
	IsBuiltin           bool
	Enabled             bool
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// BusinessMetric is the business-semantics contract of a metric.
type BusinessMetric struct {
	ID                  string
	MetricID            string
	MetricName          string
	Description         string
	MetricType          MetricType
	Unit                string
	BusinessDomain      string
	AppName             string
	ThresholdSuggestion string
	Owner               string
	RegisterSource      RegisterSource
	Status              BusinessMetricStatus
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// Installation is an optional exporter installation note keyed by
// (resource_id, scrape_job_id). It never gates target generation.
type Installation struct {
	ID          string
	ResourceID  string
	ScrapeJobID string
	Status      InstallationStatus
	ActualPort  int
	ConfirmedBy string
	Notes       string
	ConfirmedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// ProbeModule is one blackbox_exporter module definition.
type ProbeModule struct {
	ID        string
	Name      string
	Content   string
	IsBuiltin bool
	Enabled   bool
	CreatedAt time.Time
	UpdatedAt time.Time
}
