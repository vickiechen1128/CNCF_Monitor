package domain

// ResourceRef is the read-only projection of an M07 v3 resource used by M01
// for candidate listing, validation and target address resolution.
//
// The attribute fields (BizCode … APIURL) mirror the M07 resource tables so
// M09 can expand label-template mappings without importing M07 domain models.
// Times are RFC3339 strings; empty means unset.
type ResourceRef struct {
	ID              string
	TenantID        string
	Category        ResourceCategory
	NetworkDomainID string
	Status          string
	DisplayName     string
	InstanceIP      string
	Port            int
	ScrapePort      int
	MetricsPath     string
	Scheme          string
	TargetURL       string
	Endpoint        string

	// Shared resource fields (resources table).
	BizCode      string
	AppCode      string
	PlatformCode string
	Env          string
	Cluster      string
	Owner        string

	// Host fields.
	Hostname    string
	OSType      string
	OSVersion   string
	ActivatedAt string

	// Database / middleware fields.
	DatabaseType      string
	DatabaseVersion   string
	MiddlewareType    string
	MiddlewareVersion string

	// Application fields.
	ServiceName      string
	HealthCheckURL   string
	Protocol         string
	Owner1           string
	Owner1Contact    string
	Owner2           string
	Owner2Contact    string
	OpsPerson        string
	OpsPersonContact string
	GoLiveAt         string

	// Generic target fields.
	TargetName   string
	ExporterType string

	// Interface service fields.
	APIName string
	APIURL  string
}

// Selectable reports whether the resource can be newly added to a job.
func (r ResourceRef) Selectable() bool { return r.Status == "online" }

// DomainRef is the read-only projection of an M06 network domain plus its M09
// onboarding state.
type DomainRef struct {
	ID                 string
	Name               string
	Status             string
	DomainType         string
	RegistrationStatus string
	// TenantID is the registering tenant (platform_admin in v3).
	TenantID string
	// AuthorizedTenantIDs lists the tenants the domain is shared with (M06).
	AuthorizedTenantIDs []string
}

// AuthorizedFor reports whether tenantID may use this network domain: it is
// either the owner or explicitly authorized. Platform administrators are
// handled by the caller (it does not rely on this helper).
func (d DomainRef) AuthorizedFor(tenantID string) bool {
	if tenantID == "" {
		return false
	}
	if d.TenantID == tenantID {
		return true
	}
	for _, id := range d.AuthorizedTenantIDs {
		if id == tenantID {
			return true
		}
	}
	return false
}

// Eligible reports whether a job may bind the domain: registered, enabled,
// edge/collection type and onboarded by M09 (SRS NFR-02 / D26).
func (d DomainRef) Eligible() bool {
	if d.Status != "enabled" {
		return false
	}
	if d.DomainType != "edge" && d.DomainType != "collection" {
		return false
	}
	return d.RegistrationStatus == "monitored"
}

// CandidateFilterOp is a supported comparison on a candidate filter field.
type CandidateFilterOp string

// Candidate filter operators (SRS JG v1.1 FR-JG-11: AND composition only).
const (
	CandidateOpIn       CandidateFilterOp = "in"       // multi-value membership
	CandidateOpEq       CandidateFilterOp = "eq"       // exact text match
	CandidateOpContains CandidateFilterOp = "contains" // text contains
)

// CandidateFilter is one user-composable filter condition. Multiple conditions
// are ANDed together; repeating a field merges by AND (in → intersection).
type CandidateFilter struct {
	Field  string
	Op     CandidateFilterOp
	Values []string
}

// CandidateQuery filters resource candidates for a job.
//
// NetworkDomainID is the legacy single-domain selector (kept for the old GET
// endpoint); new callers put `network_domain_id` into Filters so a job can span
// several domains (SRS JG v1.1 §5.3).
type CandidateQuery struct {
	MonitorType     string
	Category        ResourceCategory
	NetworkDomainID string
	Filters         []CandidateFilter
	Keyword         string
	// TenantIDs scopes the candidates to the caller's tenant set (empty = no
	// restriction, used for platform administrators). Fail-closed scoping is
	// applied by the handler/service, never by the browser.
	TenantIDs []string
	// IDsOnly asks for matching resource ids only (select-all resolution).
	IDsOnly  bool
	MaxIDs   int
	Page     int
	PageSize int
}

// CandidatePage is a candidate list plus the per-domain counts used for the
// save-time per-domain preview (SRS FR-JG-12).
type CandidatePage struct {
	Refs       []ResourceRef
	Total      int64
	DomainHits []DomainHit
	IDs        []string
	Truncated  bool
}

// DomainHit is one network domain plus the number of matching candidates.
type DomainHit struct {
	NetworkDomainID   string
	NetworkDomainName string
	Count             int64
}
