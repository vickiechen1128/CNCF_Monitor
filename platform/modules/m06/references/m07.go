// Package references hosts M06 cross-module read ports.
package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// M07Reader counts and samples resources attached to a network domain.
type M07Reader interface {
	CountByDomain(ctx context.Context, domainID string) (int64, error)
	SamplesByDomain(ctx context.Context, domainID string, limit int) ([]domain.ResourceSummary, error)
}

// GORMM07Reader reads the shared resources table owned by M07.
type GORMM07Reader struct {
	db *gorm.DB
}

// NewGORMM07Reader constructs a reader.
func NewGORMM07Reader(db *gorm.DB) *GORMM07Reader {
	return &GORMM07Reader{db: db}
}

// CountByDomain counts live resources attached to the domain.
func (r *GORMM07Reader) CountByDomain(ctx context.Context, domainID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Raw(
		`SELECT count(*) FROM resources WHERE network_domain_id = ? AND deleted_at IS NULL`, domainID,
	).Scan(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count resources for network domain %q: %w", domainID, err)
	}
	return count, nil
}

// SamplesByDomain returns a few live resources for the delete-conflict summary.
func (r *GORMM07Reader) SamplesByDomain(ctx context.Context, domainID string, limit int) ([]domain.ResourceSummary, error) {
	if limit <= 0 {
		limit = 5
	}
	var rows []domain.ResourceSummary
	err := r.db.WithContext(ctx).Raw(`
		SELECT r.resource_id,
		       r.resource_category,
		       COALESCE(h.hostname, d.database_type, m.middleware_type,
		                a.service_name, g.target_name, i.api_name, r.resource_id) AS name
		FROM resources r
		LEFT JOIN host_resources h ON h.resource_id = r.resource_id
		LEFT JOIN database_resources d ON d.resource_id = r.resource_id
		LEFT JOIN middleware_resources m ON m.resource_id = r.resource_id
		LEFT JOIN application_resources a ON a.resource_id = r.resource_id
		LEFT JOIN generic_target_resources g ON g.resource_id = r.resource_id
		LEFT JOIN interface_service_resources i ON i.resource_id = r.resource_id
		WHERE r.network_domain_id = ? AND r.deleted_at IS NULL
		ORDER BY r.created_at ASC, r.resource_id ASC
		LIMIT ?`, domainID, limit,
	).Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("sample resources for network domain %q: %w", domainID, err)
	}
	return rows, nil
}
