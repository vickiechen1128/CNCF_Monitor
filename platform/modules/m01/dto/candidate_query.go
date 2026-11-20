package dto

// CandidateFilterRequest is one user-composable filter condition (SRS JG v1.1
// FR-JG-11). Conditions are ANDed; repeating a field merges with AND.
type CandidateFilterRequest struct {
	Field  string   `json:"field"`
	Op     string   `json:"op"`
	Values []string `json:"values"`
}

// CandidateQueryRequest is the POST /scrape-jobs/instance-candidates/query body.
// POST is used because composable filters do not fit comfortably in a URL.
type CandidateQueryRequest struct {
	TemplateCode     string                   `json:"template_code"`
	Selector         SelectorDTO              `json:"selector"`
	ResourceCategory string                   `json:"resource_category"`
	Filters          []CandidateFilterRequest `json:"filters"`
	Keyword          string                   `json:"keyword"`
	Page             int                      `json:"page"`
	PageSize         int                      `json:"page_size"`
}

// CandidateIDsRequest is the select-all body: same filters, ids only.
type CandidateIDsRequest struct {
	TemplateCode     string                   `json:"template_code"`
	Selector         SelectorDTO              `json:"selector"`
	ResourceCategory string                   `json:"resource_category"`
	Filters          []CandidateFilterRequest `json:"filters"`
	Keyword          string                   `json:"keyword"`
}

// DomainHitResponse is one network domain with the matching candidate count,
// used directly by the save-time per-domain preview (FR-JG-12).
type DomainHitResponse struct {
	NetworkDomainID   string `json:"network_domain_id"`
	NetworkDomainName string `json:"network_domain_name"`
	Count             int64  `json:"count"`
}

// CandidateQueryResponse is the composable-filter list response.
type CandidateQueryResponse struct {
	List      []CandidateResponse `json:"list"`
	Total     int64               `json:"total"`
	Page      int                 `json:"page"`
	PageSize  int                 `json:"page_size"`
	Domains   []DomainHitResponse `json:"domains"`
	Truncated bool                `json:"truncated"`
}

// CandidateIDsResponse is the select-all response (upper bound enforced).
type CandidateIDsResponse struct {
	IDs       []string `json:"ids"`
	Total     int64    `json:"total"`
	Truncated bool     `json:"truncated"`
	MaxIDs    int      `json:"max_ids"`
}

// CandidateFilterFieldResponse describes one filterable field for the builder.
type CandidateFilterFieldResponse struct {
	Key     string                          `json:"key"`
	Label   string                          `json:"label"`
	Type    string                          `json:"type"`
	Ops     []string                        `json:"ops"`
	Source  string                          `json:"source,omitempty"`
	Default []string                        `json:"default,omitempty"`
	Options []CandidateFilterOptionResponse `json:"options,omitempty"`
}

// CandidateFilterOptionResponse is one static enum choice.
type CandidateFilterOptionResponse struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// CandidateFilterSchemaResponse is the schema payload for the condition builder.
type CandidateFilterSchemaResponse struct {
	Fields []CandidateFilterFieldResponse `json:"fields"`
}
