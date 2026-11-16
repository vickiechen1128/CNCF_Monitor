package domain

// ResourceRef is the read-only projection of an M07 v3 resource used by M01
// for candidate listing, validation and target address resolution.
type ResourceRef struct {
	ID              string
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

// CandidateQuery filters resource candidates for a job.
type CandidateQuery struct {
	MonitorType     string
	Category        ResourceCategory
	NetworkDomainID string
	Keyword         string
	Page            int
	PageSize        int
}
