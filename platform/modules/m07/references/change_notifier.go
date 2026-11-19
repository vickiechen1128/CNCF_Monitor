package references

import "context"

// ResourceChangeNotifier receives best-effort M07 write notifications.
//
// Implementations must be non-blocking (the composition root queues work):
// a failed notification never fails the resource write, and M09's 30s watcher /
// M01's 60s reconcile remain the authoritative fallback.
type ResourceChangeNotifier interface {
	// ResourceChanged reports writes that affect the given network domains.
	// An empty domain list means "no domain-specific change".
	ResourceChanged(ctx context.Context, domainIDs ...string)
	// AllResourcesChanged reports bulk/import/template changes that may affect
	// every network domain.
	AllResourcesChanged(ctx context.Context)
}

// NoopChangeNotifier is the default when no cross-module notifier is wired.
type NoopChangeNotifier struct{}

// ResourceChanged implements ResourceChangeNotifier.
func (NoopChangeNotifier) ResourceChanged(context.Context, ...string) {}

// AllResourcesChanged implements ResourceChangeNotifier.
func (NoopChangeNotifier) AllResourcesChanged(context.Context) {}
