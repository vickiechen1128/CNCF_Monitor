package references

import "context"

// MonitoringImpact is the M09/M11 contribution to a domain impact view.
type MonitoringImpact struct {
	ManagedEdgeAgentCount int64
	HasOnlineAgents       bool
}

// MonitoringRetirer is the port used by M06 to retire monitoring state when a
// network domain is deleted. M09/M11 v3 has not landed yet; NoopMonitoring is
// the safe default (Available=false, RetireDomain is a no-op).
type MonitoringRetirer interface {
	Available() bool
	Impact(ctx context.Context, domainID string) (MonitoringImpact, error)
	RetireDomain(ctx context.Context, domainID string) error
}

// NoopMonitoring is used until M09/M11 v3 provides a real implementation.
type NoopMonitoring struct{}

// Available reports false so callers can surface monitoring_available=false.
func (NoopMonitoring) Available() bool { return false }

// Impact returns an empty impact.
func (NoopMonitoring) Impact(context.Context, string) (MonitoringImpact, error) {
	return MonitoringImpact{}, nil
}

// RetireDomain is a no-op.
func (NoopMonitoring) RetireDomain(context.Context, string) error { return nil }
