package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// ResourceReader reads M07 v3 resources for M01 candidate listing and
// validation. It is read-only and never joins M01 tables.
type ResourceReader interface {
	ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]domain.ResourceRef, int64, error)
	GetMany(ctx context.Context, resourceIDs []string) (map[string]domain.ResourceRef, error)
}

// GORMResourceReader is the GORM-backed implementation.
type GORMResourceReader struct {
	db *gorm.DB
}

// NewResourceReader constructs the reader.
func NewResourceReader(db *gorm.DB) *GORMResourceReader {
	return &GORMResourceReader{db: db}
}

const resourceSelect = `r.resource_id AS resource_id,
	r.resource_category AS resource_category,
	r.network_domain_id AS network_domain_id,
	r.status AS status,
	r.scrape_port AS scrape_port,
	COALESCE(h.instance_ip, d.instance_ip, m.instance_ip, g.instance_ip, '') AS instance_ip,
	COALESCE(d.port, m.port, a.port, g.port, 0) AS port,
	COALESCE(g.metrics_path, '') AS metrics_path,
	COALESCE(g.scheme, '') AS scheme,
	COALESCE(i.api_url, a.health_check_url, '') AS target_url,
	COALESCE(a.endpoint, '') AS endpoint,
	COALESCE(NULLIF(h.hostname, ''), NULLIF(d.instance_ip, ''), NULLIF(m.instance_ip, ''),
	         NULLIF(a.service_name, ''), NULLIF(g.target_name, ''), NULLIF(i.api_name, ''),
	         r.resource_id) AS display_name`

const resourceJoins = `resources AS r
	LEFT JOIN host_resources h ON h.resource_id = r.resource_id
	LEFT JOIN database_resources d ON d.resource_id = r.resource_id
	LEFT JOIN middleware_resources m ON m.resource_id = r.resource_id
	LEFT JOIN application_resources a ON a.resource_id = r.resource_id
	LEFT JOIN generic_target_resources g ON g.resource_id = r.resource_id
	LEFT JOIN interface_service_resources i ON i.resource_id = r.resource_id`

type resourceRow struct {
	ResourceID       string `gorm:"column:resource_id"`
	ResourceCategory string `gorm:"column:resource_category"`
	NetworkDomainID  string `gorm:"column:network_domain_id"`
	Status           string `gorm:"column:status"`
	ScrapePort       int    `gorm:"column:scrape_port"`
	InstanceIP       string `gorm:"column:instance_ip"`
	Port             int    `gorm:"column:port"`
	MetricsPath      string `gorm:"column:metrics_path"`
	Scheme           string `gorm:"column:scheme"`
	TargetURL        string `gorm:"column:target_url"`
	Endpoint         string `gorm:"column:endpoint"`
	DisplayName      string `gorm:"column:display_name"`
}

func (row resourceRow) toDomain() domain.ResourceRef {
	return domain.ResourceRef{
		ID:              row.ResourceID,
		Category:        domain.ResourceCategory(row.ResourceCategory),
		NetworkDomainID: row.NetworkDomainID,
		Status:          row.Status,
		DisplayName:     row.DisplayName,
		InstanceIP:      row.InstanceIP,
		Port:            row.Port,
		ScrapePort:      row.ScrapePort,
		MetricsPath:     row.MetricsPath,
		Scheme:          row.Scheme,
		TargetURL:       row.TargetURL,
		Endpoint:        row.Endpoint,
	}
}

// ListCandidates returns a page of resources matching a monitor type (or a
// blackbox category) inside one network domain.
func (r *GORMResourceReader) ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]domain.ResourceRef, int64, error) {
	category, subtypeColumn, subtypeValue, err := candidateScope(query.MonitorType, query.Category)
	if err != nil {
		return nil, 0, err
	}
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).
			Table(resourceJoins).
			Where("r.deleted_at IS NULL").
			Where("r.network_domain_id = ?", query.NetworkDomainID).
			Where("r.resource_category = ?", string(category)).
			Where("r.status <> ?", "maintenance")
		if subtypeColumn != "" {
			q = q.Where(subtypeColumn+" = ?", subtypeValue)
		}
		if query.Keyword != "" {
			like := "%" + query.Keyword + "%"
			q = q.Where("(COALESCE(h.hostname, d.instance_ip, m.instance_ip, a.service_name, g.target_name, i.api_name, r.resource_id) LIKE ? "+
				"OR COALESCE(h.instance_ip, d.instance_ip, m.instance_ip, g.instance_ip, '') LIKE ?)", like, like)
		}
		return q
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, fmt.Errorf("count resource candidates: %w", err)
	}
	page, pageSize := normalizePage(query.Page, query.PageSize)
	var rows []resourceRow
	if err := build().
		Select(resourceSelect).
		Order("CASE WHEN r.status = 'online' THEN 0 ELSE 1 END, r.resource_id ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Scan(&rows).Error; err != nil {
		return nil, 0, fmt.Errorf("list resource candidates: %w", err)
	}
	out := make([]domain.ResourceRef, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.toDomain())
	}
	return out, total, nil
}

// GetMany loads resources by id (including offline ones) for validation.
func (r *GORMResourceReader) GetMany(ctx context.Context, resourceIDs []string) (map[string]domain.ResourceRef, error) {
	out := make(map[string]domain.ResourceRef, len(resourceIDs))
	if len(resourceIDs) == 0 {
		return out, nil
	}
	var rows []resourceRow
	if err := r.db.WithContext(ctx).
		Table(resourceJoins).
		Select(resourceSelect).
		Where("r.deleted_at IS NULL AND r.resource_id IN ?", resourceIDs).
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("load resources: %w", err)
	}
	for _, row := range rows {
		out[row.ResourceID] = row.toDomain()
	}
	return out, nil
}

func candidateScope(monitorType string, category domain.ResourceCategory) (domain.ResourceCategory, string, string, error) {
	if monitorType == "" {
		if category == domain.CategoryInterfaceService || category == domain.CategoryApplication {
			return category, "", "", nil
		}
		return "", "", "", domain.NewValidationError("monitor_type", "is required for standard jobs")
	}
	switch monitorType {
	case domain.MonitorTypeHostLinux:
		return domain.CategoryHost, "h.os_type", "linux", nil
	case domain.MonitorTypeHostWindows:
		return domain.CategoryHost, "h.os_type", "windows", nil
	case domain.MonitorTypeNPU:
		return domain.CategoryHost, "", "", nil
	case domain.MonitorTypeMySQL:
		return domain.CategoryDatabase, "d.database_type", "mysql", nil
	case domain.MonitorTypeRedis:
		return domain.CategoryDatabase, "d.database_type", "redis", nil
	case domain.MonitorTypeKafka:
		return domain.CategoryMiddleware, "m.middleware_type", "kafka", nil
	case domain.MonitorTypeElasticsearch:
		return domain.CategoryMiddleware, "m.middleware_type", "elasticsearch", nil
	case domain.MonitorTypeNginx:
		return domain.CategoryMiddleware, "m.middleware_type", "nginx", nil
	case domain.MonitorTypeApplicationHTTP:
		return domain.CategoryApplication, "", "", nil
	case domain.MonitorTypeSNMP:
		return domain.CategoryGenericTarget, "", "", nil
	default:
		return "", "", "", domain.NewValidationErrorf("monitor_type", "unknown monitor type %q", monitorType)
	}
}

func normalizePage(page, pageSize int) (int, int) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}
