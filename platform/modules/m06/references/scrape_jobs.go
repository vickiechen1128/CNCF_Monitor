package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// ScrapeJobCounter counts live M01 scrape jobs that still reference a network
// domain. It is a read-only cross-module port: M06 uses it to surface job
// references in the delete/impact view instead of relying on the database's
// NO ACTION foreign key to reject the delete with an opaque error.
type ScrapeJobCounter interface {
	CountByDomain(ctx context.Context, domainID string) (int64, error)
}

// NoopScrapeJobCounter reports zero jobs. It is the safe default when no M01
// reader is wired (e.g. in tests or minimal deployments).
type NoopScrapeJobCounter struct{}

// CountByDomain always returns zero.
func (NoopScrapeJobCounter) CountByDomain(context.Context, string) (int64, error) {
	return 0, nil
}

// GORMScrapeJobCounter counts live rows in the shared m01_scrape_jobs table.
// It mirrors GORMM07Reader: only the table name is shared across the module
// boundary, so there is no Go-level dependency on M01 packages.
type GORMScrapeJobCounter struct {
	db *gorm.DB
}

// NewGORMScrapeJobCounter constructs a scrape job counter.
func NewGORMScrapeJobCounter(db *gorm.DB) *GORMScrapeJobCounter {
	return &GORMScrapeJobCounter{db: db}
}

// CountByDomain counts non-deleted M01 scrape jobs attached to the domain.
func (r *GORMScrapeJobCounter) CountByDomain(ctx context.Context, domainID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(
		`SELECT count(*) FROM m01_scrape_jobs WHERE network_domain_id = ? AND deleted_at IS NULL`, domainID,
	).Scan(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count scrape jobs for network domain %q: %w", domainID, err)
	}
	return count, nil
}
