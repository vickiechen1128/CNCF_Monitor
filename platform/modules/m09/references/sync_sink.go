package references

import (
	"context"
	"time"
)

// SyncResultSink records M09 generation outcomes into the owning module (M01).
// It is injected by the v3 composition root; M09 does not write M01 tables
// directly. The outcome map is key → error message, where an empty message
// means "synced".
type SyncResultSink interface {
	RecordDomainSync(ctx context.Context, domainID, version string, generatedAt time.Time, outcomes map[string]string) error
	RecordRuleSync(ctx context.Context, version string, generatedAt time.Time, outcomes map[string]string) error
}
