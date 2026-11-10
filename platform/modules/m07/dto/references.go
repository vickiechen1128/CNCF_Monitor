package dto

// JobReference is a read-only ScrapeJob reference.
type JobReference struct {
	JobName         string `json:"job_name"`
	NetworkDomainID string `json:"network_domain_id"`
	Enabled         bool   `json:"enabled"`
}

// ReferencesResponse is the referenced-by response.
type ReferencesResponse struct {
	Jobs  []JobReference `json:"jobs"`
	Total int            `json:"total"`
}
