// Package dto holds the v3 homepage-summary response structs. They were
// originally defined in the legacy platform/dashboard package; moving them
// here keeps the v3 binary from linking that package while leaving the JSON
// contract byte-for-byte identical (platform/dashboard now aliases these
// types so the unchanged tests keep compiling).
package dto

import "time"

// Summary is the homepage aggregate response.
type Summary struct {
	ResourceCount         int `json:"resource_count"`
	MonitoredCount        int `json:"monitored_count"`
	ScrapeJobCount        int `json:"scrape_job_count"`
	ScrapeJobEnabledCount int `json:"scrape_job_enabled_count"`
	DomainCount           int `json:"domain_count"`

	ByCategory                 []CategorySummary `json:"by_category"`
	ByApp                      []AppSummary      `json:"by_app"`
	UnclassifiedResourceCount  int               `json:"unclassified_resource_count"`
	UnclassifiedMonitoredCount int               `json:"unclassified_monitored_count"`
	ProbeTargetCount           int               `json:"probe_target_count"`
	ProbeTargetAbnormalCount   int               `json:"probe_target_abnormal_count"`
	ProbeTargets               []ProbeTargetItem `json:"probe_targets"`

	CollectionHealth *CollectionHealth `json:"collection_health,omitempty"`

	ByPlatformApp []PlatformAppSummary `json:"by_platform_app"`
	ByCloud       []CloudSummary       `json:"by_cloud"`
}

// CategorySummary is one resource-category aggregate.
type CategorySummary struct {
	ResourceCategory string           `json:"resource_category"`
	ResourceCount    int              `json:"resource_count"`
	MonitoredCount   int              `json:"monitored_count"`
	BySubtype        []SubtypeSummary `json:"by_subtype"`
}

// SubtypeSummary is one collection-subtype bucket.
type SubtypeSummary struct {
	Subtype        string `json:"subtype"`
	ResourceCount  int    `json:"resource_count"`
	MonitoredCount int    `json:"monitored_count"`
}

// AppSummary is one application row.
type AppSummary struct {
	AppCode        string `json:"app_code"`
	AppName        string `json:"app_name"`
	BizCode        string `json:"biz_code"`
	BizName        string `json:"biz_name"`
	ResourceCount  int    `json:"resource_count"`
	MonitoredCount int    `json:"monitored_count"`
}

// PlatformAppSummary is one row of the platform × application host matrix.
type PlatformAppSummary struct {
	PlatformCode string            `json:"platform_code"`
	PlatformName string            `json:"platform_name"`
	Cells        []PlatformAppCell `json:"cells"`
	HostCount    int               `json:"host_count"`
}

// PlatformAppCell is one cell of the platform × application host matrix.
type PlatformAppCell struct {
	AppCode   string `json:"app_code"`
	AppName   string `json:"app_name"`
	HostCount int    `json:"host_count"`
}

// CloudSummary is one row of the by-cloud host aggregate.
type CloudSummary struct {
	CloudCode      string `json:"cloud_code"`
	CloudName      string `json:"cloud_name"`
	ResourceCount  int    `json:"resource_count"`
	MonitoredCount int    `json:"monitored_count"`
	CoverageRate   int    `json:"coverage_rate"`
}

// ProbeTargetItem is one blackbox probe target.
type ProbeTargetItem struct {
	URL               string     `json:"url"`
	ServiceName       string     `json:"service_name"`
	PlatformNames     string     `json:"platform_names"`
	ResourceCategory  string     `json:"resource_category"`
	Status            string     `json:"status"`
	NetworkDomainID   string     `json:"network_domain_id"`
	NetworkDomainName string     `json:"network_domain_name"`
	LastProbeAt       *time.Time `json:"last_probe_at"`
}

// CollectionHealth is the three-state collection health aggregate.
// Invariant: DispatchedCount == CollectingCount + PartialCollectingCount + DownCount.
type CollectionHealth struct {
	DispatchedCount        int `json:"dispatched_count"`
	CollectingCount        int `json:"collecting_count"`
	PartialCollectingCount int `json:"partial_collecting_count"`
	DownCount              int `json:"down_count"`
}
