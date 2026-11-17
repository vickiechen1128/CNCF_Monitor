// Package references holds the outbound ports M08 depends on plus their
// read-only GORM adapters. M08 never writes another module's tables.
package references

import "context"

// AlertmanagerSnapshotSink persists a generated alertmanager.yml in M09 as
// read-only history (D31). M09 implements this port; the snapshot is never
// fanned out to edge domains and never becomes the current scrape config.
type AlertmanagerSnapshotSink interface {
	SaveAlertmanagerSnapshot(ctx context.Context, domainID, content, checksum, generatedBy string) error
}
