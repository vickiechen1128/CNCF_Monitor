package references

import "context"

// AlertmanagerSnapshotSink is the port M08 uses to persist the alertmanager.yml
// it generated. M09 keeps it as read-only snapshot history and does NOT fan it
// out to edge domains (D31): edge agents only receive the scrape config package.
type AlertmanagerSnapshotSink interface {
	// SaveAlertmanagerSnapshot stores the alertmanager.yml content and checksum
	// for a network domain. It never becomes the current scrape config snapshot.
	SaveAlertmanagerSnapshot(ctx context.Context, domainID, content, checksum, generatedBy string) error
}
