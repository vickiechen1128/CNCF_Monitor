// Package repository contains the v3 M01 persistence adapters.
//
// Records in this package mirror the `m01_*` tables one-to-one; domain entities
// are converted at the boundary so business code never depends on GORM types.
package repository

import (
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// exporterTemplateRecord maps m01_exporter_templates.
type exporterTemplateRecord struct {
	ID                    string         `gorm:"column:id;primaryKey"`
	Name                  string         `gorm:"column:name;not null"`
	Version               string         `gorm:"column:version;not null"`
	DefaultPort           int            `gorm:"column:default_port;not null"`
	MetricsPath           string         `gorm:"column:metrics_path;not null"`
	Scheme                string         `gorm:"column:scheme;not null"`
	SupportedMonitorTypes []string       `gorm:"column:supported_monitor_types;serializer:json;not null"`
	OS                    string         `gorm:"column:os;not null"`
	Arch                  string         `gorm:"column:arch;not null"`
	DownloadURL           string         `gorm:"column:download_url;not null"`
	Homepage              string         `gorm:"column:homepage;not null"`
	InstallGuide          string         `gorm:"column:install_guide;not null"`
	Description           string         `gorm:"column:description;not null"`
	IsBuiltin             bool           `gorm:"column:is_builtin;not null"`
	Source                string         `gorm:"column:source;not null"`
	CreatedAt             time.Time      `gorm:"column:created_at"`
	UpdatedAt             time.Time      `gorm:"column:updated_at"`
	DeletedAt             gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (exporterTemplateRecord) TableName() string { return "m01_exporter_templates" }

func (r exporterTemplateRecord) toDomain() *domain.ExporterTemplate {
	return &domain.ExporterTemplate{
		ID:                    r.ID,
		Name:                  r.Name,
		Version:               r.Version,
		DefaultPort:           r.DefaultPort,
		MetricsPath:           r.MetricsPath,
		Scheme:                domain.Scheme(r.Scheme),
		SupportedMonitorTypes: nonNilStrings(r.SupportedMonitorTypes),
		OS:                    r.OS,
		Arch:                  r.Arch,
		DownloadURL:           r.DownloadURL,
		Homepage:              r.Homepage,
		InstallGuide:          r.InstallGuide,
		Description:           r.Description,
		IsBuiltin:             r.IsBuiltin,
		Source:                domain.ExporterSource(r.Source),
		CreatedAt:             r.CreatedAt,
		UpdatedAt:             r.UpdatedAt,
	}
}

func exporterTemplateFromDomain(e *domain.ExporterTemplate) exporterTemplateRecord {
	return exporterTemplateRecord{
		ID:                    e.ID,
		Name:                  e.Name,
		Version:               e.Version,
		DefaultPort:           e.DefaultPort,
		MetricsPath:           e.MetricsPath,
		Scheme:                string(e.Scheme),
		SupportedMonitorTypes: nonNilStrings(e.SupportedMonitorTypes),
		OS:                    e.OS,
		Arch:                  e.Arch,
		DownloadURL:           e.DownloadURL,
		Homepage:              e.Homepage,
		InstallGuide:          e.InstallGuide,
		Description:           e.Description,
		IsBuiltin:             e.IsBuiltin,
		Source:                string(e.Source),
		CreatedAt:             e.CreatedAt,
		UpdatedAt:             e.UpdatedAt,
	}
}

// mappingRecord maps m01_ci_type_exporter_mappings.
type mappingRecord struct {
	ID                 string         `gorm:"column:id;primaryKey"`
	MonitorType        string         `gorm:"column:monitor_type;not null"`
	ExporterTemplateID string         `gorm:"column:exporter_template_id;not null"`
	IsDefault          bool           `gorm:"column:is_default;not null"`
	DefaultPort        int            `gorm:"column:default_port;not null"`
	MetricsPath        string         `gorm:"column:metrics_path;not null"`
	Scheme             string         `gorm:"column:scheme;not null"`
	ScrapeInterval     string         `gorm:"column:scrape_interval;not null"`
	ScrapeTimeout      string         `gorm:"column:scrape_timeout;not null"`
	LabelTemplateID    string         `gorm:"column:label_template_id;not null"`
	IsBuiltin          bool           `gorm:"column:is_builtin;not null"`
	CreatedAt          time.Time      `gorm:"column:created_at"`
	UpdatedAt          time.Time      `gorm:"column:updated_at"`
	DeletedAt          gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (mappingRecord) TableName() string { return "m01_ci_type_exporter_mappings" }

func (r mappingRecord) toDomain() *domain.Mapping {
	return &domain.Mapping{
		ID:                 r.ID,
		MonitorType:        r.MonitorType,
		ExporterTemplateID: r.ExporterTemplateID,
		IsDefault:          r.IsDefault,
		DefaultPort:        r.DefaultPort,
		MetricsPath:        r.MetricsPath,
		Scheme:             domain.Scheme(r.Scheme),
		ScrapeInterval:     r.ScrapeInterval,
		ScrapeTimeout:      r.ScrapeTimeout,
		LabelTemplateID:    r.LabelTemplateID,
		IsBuiltin:          r.IsBuiltin,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}
}

func mappingFromDomain(m *domain.Mapping) mappingRecord {
	return mappingRecord{
		ID:                 m.ID,
		MonitorType:        m.MonitorType,
		ExporterTemplateID: m.ExporterTemplateID,
		IsDefault:          m.IsDefault,
		DefaultPort:        m.DefaultPort,
		MetricsPath:        m.MetricsPath,
		Scheme:             string(m.Scheme),
		ScrapeInterval:     m.ScrapeInterval,
		ScrapeTimeout:      m.ScrapeTimeout,
		LabelTemplateID:    m.LabelTemplateID,
		IsBuiltin:          m.IsBuiltin,
		CreatedAt:          m.CreatedAt,
		UpdatedAt:          m.UpdatedAt,
	}
}

// jobRecord maps m01_scrape_jobs.
type jobRecord struct {
	ID                    string                   `gorm:"column:id;primaryKey"`
	JobName               string                   `gorm:"column:job_name;not null"`
	JobType               string                   `gorm:"column:job_type;not null"`
	ResourceCategory      string                   `gorm:"column:resource_category;not null"`
	MonitorType           string                   `gorm:"column:monitor_type;not null"`
	ExporterTemplateID    string                   `gorm:"column:exporter_template_id;not null"`
	NetworkDomainID       string                   `gorm:"column:network_domain_id;not null"`
	InstanceSelectionMode string                   `gorm:"column:instance_selection_mode;not null"`
	SelectedInstanceIDs   []string                 `gorm:"column:selected_instance_ids;serializer:json;not null"`
	ScrapeInterval        string                   `gorm:"column:scrape_interval;not null"`
	ScrapeTimeout         string                   `gorm:"column:scrape_timeout;not null"`
	MetricsPath           string                   `gorm:"column:metrics_path;not null"`
	Scheme                string                   `gorm:"column:scheme;not null"`
	AuthType              string                   `gorm:"column:auth_type;not null"`
	Username              string                   `gorm:"column:username;not null"`
	PasswordCipher        string                   `gorm:"column:password_cipher;not null"`
	TokenCipher           string                   `gorm:"column:token_cipher;not null"`
	TLSSkipVerify         bool                     `gorm:"column:tls_skip_verify;not null"`
	CAFile                string                   `gorm:"column:ca_file;not null"`
	LabelTemplateID       string                   `gorm:"column:label_template_id;not null"`
	BlackboxModule        string                   `gorm:"column:blackbox_module;not null"`
	TargetField           string                   `gorm:"column:target_field;not null"`
	MappingOverrides      []domain.MappingOverride `gorm:"column:mapping_overrides;serializer:json;not null"`
	DraftStatus           string                   `gorm:"column:draft_status;not null"`
	Enabled               bool                     `gorm:"column:enabled;not null"`
	SyncStatus            string                   `gorm:"column:sync_status;not null"`
	SyncVersion           string                   `gorm:"column:sync_version;not null"`
	SyncError             string                   `gorm:"column:sync_error;not null"`
	SyncedAt              *time.Time               `gorm:"column:synced_at"`
	CreatedAt             time.Time                `gorm:"column:created_at"`
	UpdatedAt             time.Time                `gorm:"column:updated_at"`
	DeletedAt             gorm.DeletedAt           `gorm:"column:deleted_at;index"`
}

func (jobRecord) TableName() string { return "m01_scrape_jobs" }

func (r jobRecord) toDomain() *domain.Job {
	return &domain.Job{
		ID:                    r.ID,
		JobName:               r.JobName,
		JobType:               domain.JobType(r.JobType),
		ResourceCategory:      domain.ResourceCategory(r.ResourceCategory),
		MonitorType:           r.MonitorType,
		ExporterTemplateID:    r.ExporterTemplateID,
		NetworkDomainID:       r.NetworkDomainID,
		InstanceSelectionMode: domain.InstanceSelectionMode(r.InstanceSelectionMode),
		SelectedInstanceIDs:   nonNilStrings(r.SelectedInstanceIDs),
		ScrapeInterval:        r.ScrapeInterval,
		ScrapeTimeout:         r.ScrapeTimeout,
		MetricsPath:           r.MetricsPath,
		Scheme:                domain.Scheme(r.Scheme),
		AuthType:              domain.AuthType(r.AuthType),
		Username:              r.Username,
		PasswordCipher:        r.PasswordCipher,
		TokenCipher:           r.TokenCipher,
		TLSSkipVerify:         r.TLSSkipVerify,
		CAFile:                r.CAFile,
		LabelTemplateID:       r.LabelTemplateID,
		BlackboxModule:        r.BlackboxModule,
		TargetField:           r.TargetField,
		MappingOverrides:      nonNilOverrides(r.MappingOverrides),
		DraftStatus:           domain.DraftStatus(r.DraftStatus),
		Enabled:               r.Enabled,
		Sync: domain.SyncState{
			Status:   domain.SyncStatus(r.SyncStatus),
			Version:  r.SyncVersion,
			Error:    r.SyncError,
			SyncedAt: r.SyncedAt,
		},
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

func jobFromDomain(j *domain.Job) jobRecord {
	return jobRecord{
		ID:                    j.ID,
		JobName:               j.JobName,
		JobType:               string(j.JobType),
		ResourceCategory:      string(j.ResourceCategory),
		MonitorType:           j.MonitorType,
		ExporterTemplateID:    j.ExporterTemplateID,
		NetworkDomainID:       j.NetworkDomainID,
		InstanceSelectionMode: string(j.InstanceSelectionMode),
		SelectedInstanceIDs:   nonNilStrings(j.SelectedInstanceIDs),
		ScrapeInterval:        j.ScrapeInterval,
		ScrapeTimeout:         j.ScrapeTimeout,
		MetricsPath:           j.MetricsPath,
		Scheme:                string(j.Scheme),
		AuthType:              string(j.AuthType),
		Username:              j.Username,
		PasswordCipher:        j.PasswordCipher,
		TokenCipher:           j.TokenCipher,
		TLSSkipVerify:         j.TLSSkipVerify,
		CAFile:                j.CAFile,
		LabelTemplateID:       j.LabelTemplateID,
		BlackboxModule:        j.BlackboxModule,
		TargetField:           j.TargetField,
		MappingOverrides:      nonNilOverrides(j.MappingOverrides),
		DraftStatus:           string(j.DraftStatus),
		Enabled:               j.Enabled,
		SyncStatus:            string(j.Sync.Status),
		SyncVersion:           j.Sync.Version,
		SyncError:             j.Sync.Error,
		SyncedAt:              j.Sync.SyncedAt,
		CreatedAt:             j.CreatedAt,
		UpdatedAt:             j.UpdatedAt,
	}
}

// ruleRecord maps m01_monitoring_rules.
type ruleRecord struct {
	ID                 string            `gorm:"column:id;primaryKey"`
	Name               string            `gorm:"column:name;not null"`
	ContentMode        string            `gorm:"column:content_mode;not null"`
	RuleContent        string            `gorm:"column:rule_content;not null"`
	RuleType           string            `gorm:"column:rule_type;not null"`
	Expr               string            `gorm:"column:expr;not null"`
	Duration           string            `gorm:"column:duration;not null"`
	Labels             map[string]string `gorm:"column:labels;serializer:json;not null"`
	Annotations        map[string]string `gorm:"column:annotations;serializer:json;not null"`
	MonitorType        string            `gorm:"column:monitor_type;not null"`
	ExporterTemplateID string            `gorm:"column:exporter_template_id;not null"`
	Scope              string            `gorm:"column:scope;not null"`
	Enabled            bool              `gorm:"column:enabled;not null"`
	DraftStatus        string            `gorm:"column:draft_status;not null"`
	AckJobRefErrors    bool              `gorm:"column:ack_job_ref_errors;not null"`
	AckReason          string            `gorm:"column:ack_reason;not null"`
	SyncStatus         string            `gorm:"column:sync_status;not null"`
	SyncVersion        string            `gorm:"column:sync_version;not null"`
	SyncError          string            `gorm:"column:sync_error;not null"`
	SyncedAt           *time.Time        `gorm:"column:synced_at"`
	CreatedAt          time.Time         `gorm:"column:created_at"`
	UpdatedAt          time.Time         `gorm:"column:updated_at"`
	DeletedAt          gorm.DeletedAt    `gorm:"column:deleted_at;index"`
}

func (ruleRecord) TableName() string { return "m01_monitoring_rules" }

func (r ruleRecord) toDomain() *domain.Rule {
	return &domain.Rule{
		ID:                 r.ID,
		Name:               r.Name,
		ContentMode:        domain.RuleContentMode(r.ContentMode),
		RuleContent:        r.RuleContent,
		RuleType:           domain.RuleType(r.RuleType),
		Expr:               r.Expr,
		Duration:           r.Duration,
		Labels:             nonNilMap(r.Labels),
		Annotations:        nonNilMap(r.Annotations),
		MonitorType:        r.MonitorType,
		ExporterTemplateID: r.ExporterTemplateID,
		Scope:              domain.RuleScope(r.Scope),
		Enabled:            r.Enabled,
		DraftStatus:        domain.DraftStatus(r.DraftStatus),
		AckJobRefErrors:    r.AckJobRefErrors,
		AckReason:          r.AckReason,
		Sync: domain.SyncState{
			Status:   domain.SyncStatus(r.SyncStatus),
			Version:  r.SyncVersion,
			Error:    r.SyncError,
			SyncedAt: r.SyncedAt,
		},
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

func ruleFromDomain(r *domain.Rule) ruleRecord {
	return ruleRecord{
		ID:                 r.ID,
		Name:               r.Name,
		ContentMode:        string(r.ContentMode),
		RuleContent:        r.RuleContent,
		RuleType:           string(r.RuleType),
		Expr:               r.Expr,
		Duration:           r.Duration,
		Labels:             nonNilMap(r.Labels),
		Annotations:        nonNilMap(r.Annotations),
		MonitorType:        r.MonitorType,
		ExporterTemplateID: r.ExporterTemplateID,
		Scope:              string(r.Scope),
		Enabled:            r.Enabled,
		DraftStatus:        string(r.DraftStatus),
		AckJobRefErrors:    r.AckJobRefErrors,
		AckReason:          r.AckReason,
		SyncStatus:         string(r.Sync.Status),
		SyncVersion:        r.Sync.Version,
		SyncError:          r.Sync.Error,
		SyncedAt:           r.Sync.SyncedAt,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}
}

// metricRecord maps m01_metric_library.
type metricRecord struct {
	ID                 string                `gorm:"column:id;primaryKey"`
	MetricName         string                `gorm:"column:metric_name;not null"`
	MetricType         string                `gorm:"column:metric_type;not null"`
	Help               string                `gorm:"column:help;not null"`
	Unit               string                `gorm:"column:unit;not null"`
	Labels             []string              `gorm:"column:labels;serializer:json;not null"`
	MonitorTypes       []domain.MetricAnchor `gorm:"column:monitor_types;serializer:json;not null"`
	Category           string                `gorm:"column:category;not null"`
	ExporterTemplateID string                `gorm:"column:exporter_template_id;not null"`
	IsBuiltin          bool                  `gorm:"column:is_builtin;not null"`
	Enabled            bool                  `gorm:"column:enabled;not null"`
	CreatedAt          time.Time             `gorm:"column:created_at"`
	UpdatedAt          time.Time             `gorm:"column:updated_at"`
	DeletedAt          gorm.DeletedAt        `gorm:"column:deleted_at;index"`
}

func (metricRecord) TableName() string { return "m01_metric_library" }

func (r metricRecord) toDomain() *domain.Metric {
	return &domain.Metric{
		ID:                 r.ID,
		MetricName:         r.MetricName,
		MetricType:         domain.MetricType(r.MetricType),
		Help:               r.Help,
		Unit:               r.Unit,
		Labels:             nonNilStrings(r.Labels),
		MonitorTypes:       nonNilAnchors(r.MonitorTypes),
		Category:           r.Category,
		ExporterTemplateID: r.ExporterTemplateID,
		IsBuiltin:          r.IsBuiltin,
		Enabled:            r.Enabled,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}
}

func metricFromDomain(m *domain.Metric) metricRecord {
	return metricRecord{
		ID:                 m.ID,
		MetricName:         m.MetricName,
		MetricType:         string(m.MetricType),
		Help:               m.Help,
		Unit:               m.Unit,
		Labels:             nonNilStrings(m.Labels),
		MonitorTypes:       nonNilAnchors(m.MonitorTypes),
		Category:           m.Category,
		ExporterTemplateID: m.ExporterTemplateID,
		IsBuiltin:          m.IsBuiltin,
		Enabled:            m.Enabled,
		CreatedAt:          m.CreatedAt,
		UpdatedAt:          m.UpdatedAt,
	}
}

// businessMetricRecord maps m01_business_metrics.
type businessMetricRecord struct {
	ID                  string         `gorm:"column:id;primaryKey"`
	MetricID            string         `gorm:"column:metric_id;not null"`
	MetricName          string         `gorm:"column:metric_name;not null"`
	Description         string         `gorm:"column:description;not null"`
	MetricType          string         `gorm:"column:metric_type;not null"`
	Unit                string         `gorm:"column:unit;not null"`
	BusinessDomain      string         `gorm:"column:business_domain;not null"`
	AppName             string         `gorm:"column:app_name;not null"`
	ThresholdSuggestion string         `gorm:"column:threshold_suggestion;not null"`
	Owner               string         `gorm:"column:owner;not null"`
	RegisterSource      string         `gorm:"column:register_source;not null"`
	Status              string         `gorm:"column:status;not null"`
	CreatedAt           time.Time      `gorm:"column:created_at"`
	UpdatedAt           time.Time      `gorm:"column:updated_at"`
	DeletedAt           gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (businessMetricRecord) TableName() string { return "m01_business_metrics" }

func (r businessMetricRecord) toDomain() *domain.BusinessMetric {
	return &domain.BusinessMetric{
		ID:                  r.ID,
		MetricID:            r.MetricID,
		MetricName:          r.MetricName,
		Description:         r.Description,
		MetricType:          domain.MetricType(r.MetricType),
		Unit:                r.Unit,
		BusinessDomain:      r.BusinessDomain,
		AppName:             r.AppName,
		ThresholdSuggestion: r.ThresholdSuggestion,
		Owner:               r.Owner,
		RegisterSource:      domain.RegisterSource(r.RegisterSource),
		Status:              domain.BusinessMetricStatus(r.Status),
		CreatedAt:           r.CreatedAt,
		UpdatedAt:           r.UpdatedAt,
	}
}

func businessMetricFromDomain(m *domain.BusinessMetric) businessMetricRecord {
	return businessMetricRecord{
		ID:                  m.ID,
		MetricID:            m.MetricID,
		MetricName:          m.MetricName,
		Description:         m.Description,
		MetricType:          string(m.MetricType),
		Unit:                m.Unit,
		BusinessDomain:      m.BusinessDomain,
		AppName:             m.AppName,
		ThresholdSuggestion: m.ThresholdSuggestion,
		Owner:               m.Owner,
		RegisterSource:      string(m.RegisterSource),
		Status:              string(m.Status),
		CreatedAt:           m.CreatedAt,
		UpdatedAt:           m.UpdatedAt,
	}
}

// installationRecord maps m01_installations.
type installationRecord struct {
	ID          string     `gorm:"column:id;primaryKey"`
	ResourceID  string     `gorm:"column:resource_id;not null"`
	ScrapeJobID string     `gorm:"column:scrape_job_id;not null"`
	Status      string     `gorm:"column:status;not null"`
	ActualPort  int        `gorm:"column:actual_port;not null"`
	ConfirmedBy string     `gorm:"column:confirmed_by;not null"`
	Notes       string     `gorm:"column:notes;not null"`
	ConfirmedAt *time.Time `gorm:"column:confirmed_at"`
	CreatedAt   time.Time  `gorm:"column:created_at"`
	UpdatedAt   time.Time  `gorm:"column:updated_at"`
}

func (installationRecord) TableName() string { return "m01_installations" }

func (r installationRecord) toDomain() *domain.Installation {
	return &domain.Installation{
		ID:          r.ID,
		ResourceID:  r.ResourceID,
		ScrapeJobID: r.ScrapeJobID,
		Status:      domain.InstallationStatus(r.Status),
		ActualPort:  r.ActualPort,
		ConfirmedBy: r.ConfirmedBy,
		Notes:       r.Notes,
		ConfirmedAt: r.ConfirmedAt,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func installationFromDomain(i *domain.Installation) installationRecord {
	return installationRecord{
		ID:          i.ID,
		ResourceID:  i.ResourceID,
		ScrapeJobID: i.ScrapeJobID,
		Status:      string(i.Status),
		ActualPort:  i.ActualPort,
		ConfirmedBy: i.ConfirmedBy,
		Notes:       i.Notes,
		ConfirmedAt: i.ConfirmedAt,
		CreatedAt:   i.CreatedAt,
		UpdatedAt:   i.UpdatedAt,
	}
}

// probeModuleRecord maps m01_probe_modules.
type probeModuleRecord struct {
	ID        string         `gorm:"column:id;primaryKey"`
	Name      string         `gorm:"column:name;not null"`
	Content   string         `gorm:"column:content;not null"`
	IsBuiltin bool           `gorm:"column:is_builtin;not null"`
	Enabled   bool           `gorm:"column:enabled;not null"`
	CreatedAt time.Time      `gorm:"column:created_at"`
	UpdatedAt time.Time      `gorm:"column:updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (probeModuleRecord) TableName() string { return "m01_probe_modules" }

func (r probeModuleRecord) toDomain() *domain.ProbeModule {
	return &domain.ProbeModule{
		ID:        r.ID,
		Name:      r.Name,
		Content:   r.Content,
		IsBuiltin: r.IsBuiltin,
		Enabled:   r.Enabled,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

func probeModuleFromDomain(m *domain.ProbeModule) probeModuleRecord {
	return probeModuleRecord{
		ID:        m.ID,
		Name:      m.Name,
		Content:   m.Content,
		IsBuiltin: m.IsBuiltin,
		Enabled:   m.Enabled,
		CreatedAt: m.CreatedAt,
		UpdatedAt: m.UpdatedAt,
	}
}

func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func nonNilOverrides(in []domain.MappingOverride) []domain.MappingOverride {
	if in == nil {
		return []domain.MappingOverride{}
	}
	return in
}

func nonNilAnchors(in []domain.MetricAnchor) []domain.MetricAnchor {
	if in == nil {
		return []domain.MetricAnchor{}
	}
	return in
}

func nonNilMap(in map[string]string) map[string]string {
	if in == nil {
		return map[string]string{}
	}
	return in
}
