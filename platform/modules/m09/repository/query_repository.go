package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// EdgeTargetRow is one edge target snapshot row for the /api/v1/targets view.
type EdgeTargetRow struct {
	NetworkDomainID string     `gorm:"column:network_domain_id"`
	Job             string     `gorm:"column:job"`
	Instance        string     `gorm:"column:instance"`
	ResourceID      string     `gorm:"column:resource_id"`
	Health          string     `gorm:"column:health"`
	LastScrape      *time.Time `gorm:"column:last_scrape"`
	LastError       string     `gorm:"column:last_error"`
	LastReportAt    time.Time  `gorm:"column:last_report_at"`
}

// TargetFilter carries /api/v1/targets filters.
type TargetFilter struct {
	NetworkDomainID string
	Job             string
	Health          string
	Keyword         string
	Allowed         []string
	FreshAfter      time.Time
	Page            int
	PageSize        int
}

// QueryRepository reads the edge target snapshots for the query surface.
type QueryRepository interface {
	ListEdgeTargets(ctx context.Context, filter TargetFilter) ([]EdgeTargetRow, int64, error)
	TargetHealthCounts(ctx context.Context, allowed []string, freshAfter time.Time) (collecting, degraded int64, err error)
	UnmonitoredResourceCount(ctx context.Context, allowed []string) (int64, error)
	ListCoverageResources(ctx context.Context, filter CoverageFilter) ([]CoverageResourceRow, error)
	ListCoverageTargets(ctx context.Context, filter CoverageFilter) ([]CoverageTargetRow, error)
}

// CoverageFilter scopes the per-resource coverage report.
type CoverageFilter struct {
	Allowed          []string
	NetworkDomainID  string
	ResourceCategory string
}

// CoverageResourceRow is one M07 resource in the coverage report.
type CoverageResourceRow struct {
	ResourceID       string `gorm:"column:resource_id"`
	ResourceCategory string `gorm:"column:resource_category"`
	InstanceName     string `gorm:"column:instance_name"`
}

// CoverageTargetRow is one edge target snapshot used to derive resource state.
type CoverageTargetRow struct {
	ResourceID   string    `gorm:"column:resource_id"`
	Health       string    `gorm:"column:health"`
	LastError    string    `gorm:"column:last_error"`
	LastReportAt time.Time `gorm:"column:last_report_at"`
}

// effectiveHealthSQL derives the display health: a stale or missing report is
// downgraded to unknown (contract §7.1). It is only used as a comparison
// expression (never as a bare WHERE condition).
const effectiveHealthSQL = `(CASE WHEN last_report_at < ? OR health IS NULL OR health = '' THEN 'unknown' ELSE health END)`

// ListCoverageResources returns the resources in scope with their display
// instance name, derived from the category extension table.
func (r *GORMRepository) ListCoverageResources(ctx context.Context, filter CoverageFilter) ([]CoverageResourceRow, error) {
	q := r.db.WithContext(ctx).Table("resources AS r").
		Select(`r.resource_id AS resource_id, r.resource_category AS resource_category,
			CASE r.resource_category
			  WHEN 'host' THEN COALESCE(h.hostname, '')
			  WHEN 'database' THEN COALESCE(d.instance_ip, '') || ':' || COALESCE(CAST(d.port AS TEXT), '')
			  WHEN 'middleware' THEN COALESCE(m.instance_ip, '') || ':' || COALESCE(CAST(m.port AS TEXT), '')
			  WHEN 'application' THEN COALESCE(a.service_name, '')
			  WHEN 'generic_target' THEN COALESCE(g.target_name, '')
			  WHEN 'interface_service' THEN COALESCE(i.api_name, '')
			  ELSE '' END AS instance_name`).
		Joins("LEFT JOIN host_resources h ON h.resource_id = r.resource_id").
		Joins("LEFT JOIN database_resources d ON d.resource_id = r.resource_id").
		Joins("LEFT JOIN middleware_resources m ON m.resource_id = r.resource_id").
		Joins("LEFT JOIN application_resources a ON a.resource_id = r.resource_id").
		Joins("LEFT JOIN generic_target_resources g ON g.resource_id = r.resource_id").
		Joins("LEFT JOIN interface_service_resources i ON i.resource_id = r.resource_id").
		Where("r.deleted_at IS NULL")
	q = applyCoverageDomain(q, filter, "r.network_domain_id")
	if filter.ResourceCategory != "" {
		q = q.Where("r.resource_category = ?", filter.ResourceCategory)
	}
	var rows []CoverageResourceRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list coverage resources: %w", err)
	}
	return rows, nil
}

// ListCoverageTargets returns the edge target snapshots attached to resources.
// Snapshots without a resource_id cannot be attributed and are ignored.
func (r *GORMRepository) ListCoverageTargets(ctx context.Context, filter CoverageFilter) ([]CoverageTargetRow, error) {
	q := r.db.WithContext(ctx).Table("edge_target_snapshots").
		Select(`resource_id, COALESCE(health, '') AS health,
			COALESCE(last_error, '') AS last_error, last_report_at`).
		Where("resource_id IS NOT NULL AND resource_id <> ''")
	q = applyCoverageDomain(q, filter, "network_domain_id")
	var rows []CoverageTargetRow
	if err := q.Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("list coverage targets: %w", err)
	}
	return rows, nil
}

// applyCoverageDomain applies the authorized-domain scope to a coverage query.
func applyCoverageDomain(q *gorm.DB, filter CoverageFilter, column string) *gorm.DB {
	if len(filter.Allowed) == 0 && filter.Allowed != nil {
		return q.Where("1 = 0")
	}
	if filter.Allowed != nil {
		q = q.Where(column+" IN ?", filter.Allowed)
	}
	if filter.NetworkDomainID != "" {
		q = q.Where(column+" = ?", filter.NetworkDomainID)
	}
	return q
}

// ListEdgeTargets returns the paginated edge targets with lifecycle health.
func (r *GORMRepository) ListEdgeTargets(ctx context.Context, filter TargetFilter) ([]EdgeTargetRow, int64, error) {
	base := func() *gorm.DB {
		q := r.db.WithContext(ctx).Table("edge_target_snapshots")
		if len(filter.Allowed) == 0 && filter.Allowed != nil {
			q = q.Where("1 = 0")
		} else if filter.Allowed != nil {
			q = q.Where("network_domain_id IN ?", filter.Allowed)
		}
		if filter.NetworkDomainID != "" {
			q = q.Where("network_domain_id = ?", filter.NetworkDomainID)
		}
		if filter.Job != "" {
			q = q.Where("job = ?", filter.Job)
		}
		if filter.Health != "" {
			q = q.Where(effectiveHealthSQL+" = ?", filter.FreshAfter, filter.Health)
		}
		if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
			like := "%" + keyword + "%"
			q = q.Where("(instance LIKE ? OR resource_id LIKE ? OR job LIKE ?)", like, like, like)
		}
		return q
	}

	var total int64
	if err := base().Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count edge targets: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 20
	}
	var rows []EdgeTargetRow
	if err := base().Select(`network_domain_id, job, instance,
			COALESCE(resource_id, '') AS resource_id,
			COALESCE(health, '') AS health,
			last_scrape, COALESCE(last_error, '') AS last_error, last_report_at`).
		Order("network_domain_id ASC, job ASC, instance ASC").
		Offset((page - 1) * pageSize).Limit(pageSize).Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list edge targets: %w", err)
	}
	return rows, total, nil
}

// TargetHealthCounts aggregates edge targets into collecting (fresh + up) and
// degraded (stale or not up).
func (r *GORMRepository) TargetHealthCounts(ctx context.Context, allowed []string, freshAfter time.Time) (int64, int64, error) {
	var counts struct {
		Collecting int64 `gorm:"column:collecting"`
		Degraded   int64 `gorm:"column:degraded"`
	}
	q := r.db.WithContext(ctx).Table("edge_target_snapshots").
		Select(`COALESCE(SUM(CASE WHEN health = 'up' AND last_report_at >= ? THEN 1 ELSE 0 END), 0) AS collecting,
			COALESCE(SUM(CASE WHEN health = 'up' AND last_report_at >= ? THEN 0 ELSE 1 END), 0) AS degraded`,
			freshAfter, freshAfter)
	if len(allowed) == 0 && allowed != nil {
		q = q.Where("1 = 0")
	} else if allowed != nil {
		q = q.Where("network_domain_id IN ?", allowed)
	}
	if err := q.Scan(&counts).Error; err != nil {
		return 0, 0, fmt.Errorf("aggregate edge target health: %w", err)
	}
	return counts.Collecting, counts.Degraded, nil
}

// UnmonitoredResourceCount counts online M07 resources that no edge target
// snapshot covers (instance address match within the same domain).
func (r *GORMRepository) UnmonitoredResourceCount(ctx context.Context, allowed []string) (int64, error) {
	q := r.db.WithContext(ctx).Table("resources AS r").
		Joins("LEFT JOIN host_resources h ON h.resource_id = r.resource_id").
		Joins("LEFT JOIN database_resources d ON d.resource_id = r.resource_id").
		Joins("LEFT JOIN middleware_resources m ON m.resource_id = r.resource_id").
		Joins("LEFT JOIN generic_target_resources g ON g.resource_id = r.resource_id").
		Where(`r.deleted_at IS NULL AND r.status = 'online'`).
		Where(`NOT EXISTS (
			SELECT 1 FROM edge_target_snapshots t
			WHERE t.network_domain_id = r.network_domain_id
			  AND t.instance = CASE r.resource_category
			    WHEN 'host' THEN h.instance_ip || ':' || r.scrape_port
			    WHEN 'database' THEN d.instance_ip || ':' || d.port
			    WHEN 'middleware' THEN m.instance_ip || ':' || m.port
			    WHEN 'generic_target' THEN g.instance_ip || ':' || COALESCE(NULLIF(g.port, 0), r.scrape_port)
			    ELSE '' END
		)`)
	if len(allowed) == 0 && allowed != nil {
		q = q.Where("1 = 0")
	} else if allowed != nil {
		q = q.Where("r.network_domain_id IN ?", allowed)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count unmonitored resources: %w", err)
	}
	return count, nil
}
