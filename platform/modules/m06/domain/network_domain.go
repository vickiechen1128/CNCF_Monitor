package domain

import (
	"fmt"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/foundation/apierror"
)

// DomainType is the v3 network-domain type. The center-direct management type
// is no longer available; M06 v3 only creates edge domains.
type DomainType string

// Domain type constants.
const (
	DomainTypeEdge       DomainType = "edge"
	DomainTypeCollection DomainType = "collection"
)

// DomainStatus is the administrative enabled/disabled state.
type DomainStatus string

// Domain status constants.
const (
	DomainStatusEnabled  DomainStatus = "enabled"
	DomainStatusDisabled DomainStatus = "disabled"
)

// NetworkDomain is the M06 administrative view of a network domain. Runtime
// onboarding fields (token / agent_type / remote_write_url / heartbeats) are
// intentionally absent: they belong to M09/M11 and are not part of the v3
// administrative contract.
type NetworkDomain struct {
	ID                  string
	Name                string
	Description         string
	DomainType          DomainType
	ZoneType            string
	CloudCode           string
	TenantID            string
	AuthorizedTenantIDs []string
	Status              DomainStatus
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// CreateNetworkDomainInput is the validated service input for registration.
type CreateNetworkDomainInput struct {
	Name                string
	Description         string
	CloudCode           string
	ZoneType            string
	DomainCode          string
	DomainType          *DomainType
	AuthorizedTenantIDs []string
}

// UpdateNetworkDomainInput carries mutable fields. Nil means "not present".
type UpdateNetworkDomainInput struct {
	Name                *string
	Description         *string
	ZoneType            *string
	AuthorizedTenantIDs *[]string
}

// HasChanges reports whether at least one mutable field was supplied.
func (i UpdateNetworkDomainInput) HasChanges() bool {
	return i.Name != nil || i.Description != nil || i.ZoneType != nil || i.AuthorizedTenantIDs != nil
}

// ResourceSummary is a lightweight reference used by the impact view.
type ResourceSummary struct {
	ResourceID       string `json:"resource_id"`
	ResourceCategory string `json:"resource_category"`
	Name             string `json:"name"`
}

// Impact describes everything that would be affected by disabling or deleting
// a network domain.
type Impact struct {
	ResourceCount         int64
	SampleResources       []ResourceSummary
	ManagedEdgeAgentCount int64
	HasOnlineAgents       bool
	MonitoringAvailable   bool
}

// ParseDomainStatus parses an optional status filter.
func ParseDomainStatus(raw string) (DomainStatus, error) {
	value := DomainStatus(strings.TrimSpace(raw))
	if value == "" {
		return "", nil
	}
	if value != DomainStatusEnabled && value != DomainStatusDisabled {
		return "", &ValidationError{Field: "status", Message: fmt.Sprintf("invalid status %q: must be enabled or disabled", raw)}
	}
	return value, nil
}

// ParseDomainType parses an optional domain_type. The center-direct
// management type is rejected because v3 removed it (D16).
func ParseDomainType(raw string) (*DomainType, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}
	parsed := DomainType(value)
	if parsed != DomainTypeEdge && parsed != DomainTypeCollection {
		return nil, &ValidationError{
			Field:   "domain_type",
			Message: fmt.Sprintf("invalid domain_type %q: must be edge or collection", raw),
		}
	}
	return &parsed, nil
}

// NetworkDomainNotFoundError marks a missing network domain (HTTP 404).
type NetworkDomainNotFoundError struct {
	DomainID string
}

func (e *NetworkDomainNotFoundError) Error() string {
	return fmt.Sprintf("network domain %q not found", e.DomainID)
}

// ErrorKind returns the contract kind.
func (e *NetworkDomainNotFoundError) ErrorKind() apierror.Kind { return apierror.NotFound }

// DomainInUseError marks a delete rejected by existing references (HTTP 409).
type DomainInUseError struct {
	DomainID string
	Impact   *Impact
}

func (e *DomainInUseError) Error() string {
	if e.Impact == nil || e.Impact.ResourceCount == 0 {
		return fmt.Sprintf("network domain %q is still referenced", e.DomainID)
	}
	samples := make([]string, 0, len(e.Impact.SampleResources))
	for _, r := range e.Impact.SampleResources {
		samples = append(samples, r.ResourceID)
	}
	message := fmt.Sprintf("network domain %q is still referenced by %d resource(s)", e.DomainID, e.Impact.ResourceCount)
	if len(samples) > 0 {
		message += " (e.g. " + strings.Join(samples, ", ") + ")"
	}
	return message + "; migrate or delete them first"
}

// ErrorKind returns the contract kind.
func (e *DomainInUseError) ErrorKind() apierror.Kind { return apierror.Conflict }
