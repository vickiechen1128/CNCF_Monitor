package domain

// JobType distinguishes a standard scrape job from a blackbox probe job.
type JobType string

// Job type values.
const (
	JobTypeStandard JobType = "standard"
	JobTypeBlackbox JobType = "blackbox"
)

// Valid reports whether the job type is supported.
func (t JobType) Valid() bool {
	return t == JobTypeStandard || t == JobTypeBlackbox
}

// ResourceCategory is the coarse M07 resource category a job targets.
type ResourceCategory string

// Resource category values (aligned with M07 v3).
const (
	CategoryHost             ResourceCategory = "host"
	CategoryDatabase         ResourceCategory = "database"
	CategoryMiddleware       ResourceCategory = "middleware"
	CategoryApplication      ResourceCategory = "application"
	CategoryGenericTarget    ResourceCategory = "generic_target"
	CategoryInterfaceService ResourceCategory = "interface_service"
)

// Valid reports whether the category is known.
func (c ResourceCategory) Valid() bool {
	switch c {
	case CategoryHost, CategoryDatabase, CategoryMiddleware,
		CategoryApplication, CategoryGenericTarget, CategoryInterfaceService:
		return true
	default:
		return false
	}
}


// AuthType is the optional scrape authentication mode.
type AuthType string

// Auth type values.
const (
	AuthNone   AuthType = "none"
	AuthBasic  AuthType = "basic"
	AuthBearer AuthType = "bearer"
)

// Valid reports whether the auth mode is supported.
func (a AuthType) Valid() bool {
	return a == AuthNone || a == AuthBasic || a == AuthBearer
}

// Scheme is the scrape protocol scheme.
type Scheme string

// Scheme values.
const (
	SchemeHTTP  Scheme = "http"
	SchemeHTTPS Scheme = "https"
)

// Valid reports whether the scheme is supported.
func (s Scheme) Valid() bool { return s == SchemeHTTP || s == SchemeHTTPS }

// InstanceSelectionMode selects how job instances are chosen.
type InstanceSelectionMode string

// Instance selection values. MVP only ships manual selection.
const (
	SelectionManual InstanceSelectionMode = "manual"
	SelectionFilter InstanceSelectionMode = "filter"
)

// Valid reports whether the selection mode is known.
func (m InstanceSelectionMode) Valid() bool {
	return m == SelectionManual || m == SelectionFilter
}

// DraftStatus is the source-data draft state (orthogonal to Enabled).
type DraftStatus string

// Draft state values.
const (
	DraftStatusDraft DraftStatus = "draft"
	DraftStatusReady DraftStatus = "ready"
)

// Valid reports whether the draft state is known.
func (d DraftStatus) Valid() bool {
	return d == DraftStatusDraft || d == DraftStatusReady
}

// JobGroupStatus is the administrative state of a job group (SRS JG v1.0).
// Disabling a group disables every child job; the child jobs stay for audit.
type JobGroupStatus string

// Job group state values.
const (
	JobGroupStatusEnabled  JobGroupStatus = "enabled"
	JobGroupStatusDisabled JobGroupStatus = "disabled"
)

// Valid reports whether the group state is known.
func (s JobGroupStatus) Valid() bool {
	return s == JobGroupStatusEnabled || s == JobGroupStatusDisabled
}

// SyncStatus is the M09 synchronisation state owned by M01 (D-2).
type SyncStatus string

// Sync state values.
const (
	SyncDraft   SyncStatus = "draft"
	SyncPending SyncStatus = "pending"
	SyncSyncing SyncStatus = "syncing"
	SyncSynced  SyncStatus = "synced"
	SyncFailed  SyncStatus = "failed"
)

// Valid reports whether the sync state is known.
func (s SyncStatus) Valid() bool {
	switch s {
	case SyncDraft, SyncPending, SyncSyncing, SyncSynced, SyncFailed:
		return true
	default:
		return false
	}
}

// ExporterSource describes where an exporter implementation comes from.
type ExporterSource string

// Exporter source values.
const (
	ExporterOfficial   ExporterSource = "official"
	ExporterThirdParty ExporterSource = "third_party"
	ExporterInternal   ExporterSource = "internal"
)

// Valid reports whether the exporter source is known.
func (s ExporterSource) Valid() bool {
	return s == ExporterOfficial || s == ExporterThirdParty || s == ExporterInternal
}

// RuleContentMode defines how a rule's content is expressed.
type RuleContentMode string

// Rule content mode values.
const (
	RuleYAMLPassthrough RuleContentMode = "yaml_passthrough"
	RuleStructured      RuleContentMode = "structured"
)

// Valid reports whether the rule content mode is known.
func (m RuleContentMode) Valid() bool {
	return m == RuleYAMLPassthrough || m == RuleStructured
}

// RuleScope is the rule evaluation scope. MVP is always central (D35).
type RuleScope string

// Rule scope values.
const (
	ScopeCentral RuleScope = "central"
	ScopeEdge    RuleScope = "edge"
	ScopeBoth    RuleScope = "both"
)

// RuleType distinguishes alerting from recording rules.
type RuleType string

// Rule type values.
const (
	RuleTypeAlerting  RuleType = "alerting"
	RuleTypeRecording RuleType = "recording"
)

// Valid reports whether the rule type is known.
func (t RuleType) Valid() bool {
	return t == RuleTypeAlerting || t == RuleTypeRecording
}

// MetricType is the Prometheus metric type of a catalogue entry.
type MetricType string

// Metric type values.
const (
	MetricCounter   MetricType = "counter"
	MetricGauge     MetricType = "gauge"
	MetricHistogram MetricType = "histogram"
	MetricSummary   MetricType = "summary"
	MetricUnknown   MetricType = "unknown"
)

// Valid reports whether the metric type is known.
func (t MetricType) Valid() bool {
	switch t {
	case MetricCounter, MetricGauge, MetricHistogram, MetricSummary, MetricUnknown:
		return true
	default:
		return false
	}
}

// BusinessMetricStatus is the instrumentation state of a business metric.
type BusinessMetricStatus string

// Business metric status values.
const (
	BusinessMetricPending      BusinessMetricStatus = "pending"
	BusinessMetricInstrumented BusinessMetricStatus = "instrumented"
	BusinessMetricOnline       BusinessMetricStatus = "online"
)

// Valid reports whether the status is known.
func (s BusinessMetricStatus) Valid() bool {
	switch s {
	case BusinessMetricPending, BusinessMetricInstrumented, BusinessMetricOnline:
		return true
	default:
		return false
	}
}

// RegisterSource describes how a business metric was registered.
type RegisterSource string

// Register source values.
const (
	RegisterSourceSelf  RegisterSource = "self"
	RegisterSourceAgent RegisterSource = "agent"
)

// Valid reports whether the register source is known.
func (s RegisterSource) Valid() bool {
	return s == RegisterSourceSelf || s == RegisterSourceAgent
}

// InstallationStatus is the exporter installation note state.
type InstallationStatus string

// Installation status values.
const (
	InstallationUnconfirmed   InstallationStatus = "unconfirmed"
	InstallationConfirmed     InstallationStatus = "confirmed"
	InstallationNotApplicable InstallationStatus = "not_applicable"
)

// Valid reports whether the installation status is known.
func (s InstallationStatus) Valid() bool {
	switch s {
	case InstallationUnconfirmed, InstallationConfirmed, InstallationNotApplicable:
		return true
	default:
		return false
	}
}
