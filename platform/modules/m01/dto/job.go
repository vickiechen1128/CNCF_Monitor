package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// JobRequest is the create/update payload of a scrape job.
type JobRequest struct {
	JobName               string      `json:"job_name"`
	JobType               string      `json:"job_type"`
	ResourceCategory      string      `json:"resource_category"`
	TemplateCode          string      `json:"template_code"`
	Selector              SelectorDTO `json:"selector"`
	ExporterTemplateID    string      `json:"exporter_template_id"`
	NetworkDomainID       string      `json:"network_domain_id"`
	InstanceSelectionMode string      `json:"instance_selection_mode"`
	SelectedInstanceIDs   []string    `json:"selected_instance_ids"`
	ScrapeInterval        string      `json:"scrape_interval"`
	ScrapeTimeout         string      `json:"scrape_timeout"`
	MetricsPath           string      `json:"metrics_path"`
	Scheme                string      `json:"scheme"`
	AuthType              string      `json:"auth_type"`
	Username              string      `json:"username"`
	Password              string      `json:"password"`
	Token                 string      `json:"token"`
	TLSSkipVerify         bool        `json:"tls_skip_verify"`
	CAFile                string      `json:"ca_file"`
	LabelTemplateID       string      `json:"label_template_id"`
	BlackboxModule        string      `json:"blackbox_module"`
	DraftStatus           string      `json:"draft_status"`
	Enabled               *bool       `json:"enabled"`
	// SyncMappingDefaults is a request-only action: refresh inherited template
	// fields that the user has not overridden.
	SyncMappingDefaults bool `json:"sync_mapping_defaults"`
}

// ToDomain converts the request into a domain job (credentials are not
// encrypted here; the service owns that boundary).
func (r JobRequest) ToDomain() *domain.Job {
	job := &domain.Job{
		JobName:               r.JobName,
		JobType:               domain.JobType(r.JobType),
		ResourceCategory:      domain.ResourceCategory(r.ResourceCategory),
		TemplateCode:          r.TemplateCode,
		Selector:              r.Selector.ToDomain(),
		ExporterTemplateID:    r.ExporterTemplateID,
		NetworkDomainID:       r.NetworkDomainID,
		InstanceSelectionMode: domain.InstanceSelectionMode(r.InstanceSelectionMode),
		SelectedInstanceIDs:   r.SelectedInstanceIDs,
		ScrapeInterval:        r.ScrapeInterval,
		ScrapeTimeout:         r.ScrapeTimeout,
		MetricsPath:           r.MetricsPath,
		Scheme:                domain.Scheme(r.Scheme),
		AuthType:              domain.AuthType(r.AuthType),
		Username:              r.Username,
		TLSSkipVerify:         r.TLSSkipVerify,
		CAFile:                r.CAFile,
		LabelTemplateID:       r.LabelTemplateID,
		BlackboxModule:        r.BlackboxModule,
		DraftStatus:           domain.DraftStatus(r.DraftStatus),
	}
	job.PasswordCipher = r.Password
	job.TokenCipher = r.Token
	if r.Enabled != nil {
		job.Enabled = *r.Enabled
	}
	return job
}

// SyncResponse is the inline sync projection.
type SyncResponse struct {
	Status   string     `json:"status"`
	Version  string     `json:"version"`
	Error    string     `json:"error"`
	SyncedAt *time.Time `json:"synced_at"`
}

// JobResponse is the v3 scrape job projection.
type JobResponse struct {
	ID                   string      `json:"id"`
	JobName              string      `json:"job_name"`
	JobType              string      `json:"job_type"`
	ResourceCategory     string      `json:"resource_category"`
	TemplateCode         string      `json:"template_code"`
	Selector             SelectorDTO `json:"selector"`
	ExporterTemplateID   string      `json:"exporter_template_id"`
	ExporterTemplateName string      `json:"exporter_template_name"`
	NetworkDomainID      string      `json:"network_domain_id"`
	NetworkDomainName    string      `json:"network_domain_name"`
	// JobGroupID / JobGroupName identify the monitoring intent a job belongs to
	// (empty for legacy standalone jobs). Needed by the merged task list.
	JobGroupID            string                   `json:"job_group_id,omitempty"`
	JobGroupName          string                   `json:"job_group_name,omitempty"`
	InstanceSelectionMode string                   `json:"instance_selection_mode"`
	SelectedInstanceIDs   []string                 `json:"selected_instance_ids"`
	SelectedInstanceCount int                      `json:"selected_instance_count"`
	ScrapeInterval        string                   `json:"scrape_interval"`
	ScrapeTimeout         string                   `json:"scrape_timeout"`
	MetricsPath           string                   `json:"metrics_path"`
	Scheme                string                   `json:"scheme"`
	AuthType              string                   `json:"auth_type"`
	Username              string                   `json:"username"`
	CredentialConfigured  bool                     `json:"credential_configured"`
	TLSSkipVerify         bool                     `json:"tls_skip_verify"`
	CAFile                string                   `json:"ca_file"`
	LabelTemplateID       string                   `json:"label_template_id"`
	LabelTemplateName     string                   `json:"label_template_name"`
	BlackboxModule        string                   `json:"blackbox_module"`
	TargetField           string                   `json:"target_field"`
	MappingOverrides      []domain.MappingOverride `json:"mapping_overrides"`
	DraftStatus           string                   `json:"draft_status"`
	Enabled               bool                     `json:"enabled"`
	Sync                  SyncResponse             `json:"sync"`
	CreatedAt             time.Time                `json:"created_at"`
	UpdatedAt             time.Time                `json:"updated_at"`
}

// FromJob maps a domain job plus resolved names to the v3 projection.
func FromJob(job *domain.Job, exporterName, domainName, labelName, groupName string) JobResponse {
	overrides := job.MappingOverrides
	if overrides == nil {
		overrides = []domain.MappingOverride{}
	}
	return JobResponse{
		ID:                    job.ID,
		JobName:               job.JobName,
		JobType:               string(job.JobType),
		ResourceCategory:      string(job.ResourceCategory),
		TemplateCode:          job.TemplateCode,
		Selector:              FromSelector(job.Selector),
		ExporterTemplateID:    job.ExporterTemplateID,
		ExporterTemplateName:  exporterName,
		NetworkDomainID:       job.NetworkDomainID,
		NetworkDomainName:     domainName,
		JobGroupID:            job.JobGroupID,
		JobGroupName:          groupName,
		InstanceSelectionMode: string(job.InstanceSelectionMode),
		SelectedInstanceIDs:   job.SelectedInstanceIDs,
		SelectedInstanceCount: len(job.SelectedInstanceIDs),
		ScrapeInterval:        job.ScrapeInterval,
		ScrapeTimeout:         job.ScrapeTimeout,
		MetricsPath:           job.MetricsPath,
		Scheme:                string(job.Scheme),
		AuthType:              string(job.AuthType),
		Username:              job.Username,
		CredentialConfigured:  job.PasswordCipher != "" || job.TokenCipher != "",
		TLSSkipVerify:         job.TLSSkipVerify,
		CAFile:                job.CAFile,
		LabelTemplateID:       job.LabelTemplateID,
		LabelTemplateName:     labelName,
		BlackboxModule:        job.BlackboxModule,
		TargetField:           job.TargetField,
		MappingOverrides:      overrides,
		DraftStatus:           string(job.DraftStatus),
		Enabled:               job.Enabled,
		Sync: SyncResponse{
			Status:   string(job.Sync.Status),
			Version:  job.Sync.Version,
			Error:    job.Sync.Error,
			SyncedAt: job.Sync.SyncedAt,
		},
		CreatedAt: job.CreatedAt,
		UpdatedAt: job.UpdatedAt,
	}
}
