package dto

import "time"

// JobGroupRequest is the create/update payload of a job group (monitoring
// intent): common scrape parameters plus the instances the user picked. The
// instances may span several network domains; the service groups them and
// creates one child job per domain (SRS JG v1.0 FR-JG-01/02).
type JobGroupRequest struct {
	Name                string   `json:"name"`
	JobName             string   `json:"job_name"`
	JobType             string   `json:"job_type"`
	ResourceCategory    string   `json:"resource_category"`
	MonitorType         string   `json:"monitor_type"`
	ExporterTemplateID  string   `json:"exporter_template_id"`
	ScrapeInterval      string   `json:"scrape_interval"`
	ScrapeTimeout       string   `json:"scrape_timeout"`
	MetricsPath         string   `json:"metrics_path"`
	Scheme              string   `json:"scheme"`
	AuthType            string   `json:"auth_type"`
	Username            string   `json:"username"`
	Password            string   `json:"password"`
	Token               string   `json:"token"`
	TLSSkipVerify       bool     `json:"tls_skip_verify"`
	CAFile              string   `json:"ca_file"`
	LabelTemplateID     string   `json:"label_template_id"`
	BlackboxModule      string   `json:"blackbox_module"`
	SelectedInstanceIDs []string `json:"selected_instance_ids"`
	Enabled             *bool    `json:"enabled"`
	Status              string   `json:"status"`
}

// JobGroupSyncResponse is the derived group-level sync state. It is computed
// from the child jobs and never persisted (SRS FR-JG-05).
type JobGroupSyncResponse struct {
	Status  string `json:"status"`
	Total   int    `json:"total"`
	Synced  int    `json:"synced"`
	Failed  int    `json:"failed"`
	Pending int    `json:"pending"`
	Draft   int    `json:"draft"`
}

// JobGroupChildResponse is one per-domain child job. The child keeps every
// single-domain invariant M09 consumes; the group only adds the view.
//
// `Job` carries the full job projection so a merged task table can reuse the
// same rich columns (exporter / label template / params sync / instances) for
// child rows without an N+1 fetch (merge plan step 5).
type JobGroupChildResponse struct {
	Job *JobResponse `json:"job,omitempty"`

	NetworkDomainID   string     `json:"network_domain_id"`
	NetworkDomainName string     `json:"network_domain_name"`
	JobID             string     `json:"job_id"`
	JobName           string     `json:"job_name"`
	InstanceCount     int        `json:"instance_count"`
	Enabled           bool       `json:"enabled"`
	SyncStatus        string     `json:"sync_status"`
	SyncVersion       string     `json:"sync_version"`
	SyncError         string     `json:"sync_error"`
	SyncedAt          *time.Time `json:"synced_at"`
}

// JobGroupResponse is the group view returned by create/update/get/list.
type JobGroupResponse struct {
	ID                 string                  `json:"id"`
	Name               string                  `json:"name"`
	JobName            string                  `json:"job_name"`
	JobType            string                  `json:"job_type"`
	ResourceCategory   string                  `json:"resource_category"`
	MonitorType        string                  `json:"monitor_type"`
	ExporterTemplateID string                  `json:"exporter_template_id"`
	ScrapeInterval     string                  `json:"scrape_interval"`
	ScrapeTimeout      string                  `json:"scrape_timeout"`
	MetricsPath        string                  `json:"metrics_path"`
	Scheme             string                  `json:"scheme"`
	AuthType           string                  `json:"auth_type"`
	Username           string                  `json:"username"`
	TLSSkipVerify      bool                    `json:"tls_skip_verify"`
	CAFile             string                  `json:"ca_file"`
	LabelTemplateID    string                  `json:"label_template_id"`
	BlackboxModule     string                  `json:"blackbox_module"`
	TargetField        string                  `json:"target_field"`
	Status             string                  `json:"status"`
	CreatedBy          string                  `json:"created_by"`
	CreatedAt          time.Time               `json:"created_at"`
	UpdatedAt          time.Time               `json:"updated_at"`
	Domains            []JobGroupChildResponse `json:"domains"`
	Sync               JobGroupSyncResponse    `json:"sync"`
}

// AdoptJobGroupRequest promotes one existing standalone job into a task.
type AdoptJobGroupRequest struct {
	JobID string `json:"job_id"`
	JobGroupRequest
}
