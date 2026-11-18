package references

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// ResourceReader reads M07 v3 resources for M01 candidate listing and
// validation. It is read-only and never joins M01 tables.
type ResourceReader interface {
	ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]domain.ResourceRef, int64, error)
	// QueryCandidates is the composable-filter entry (SRS JG v1.1 §5.3): AND
	// combined filters, per-domain counts and optional ids-only resolution.
	QueryCandidates(ctx context.Context, query domain.CandidateQuery) (domain.CandidatePage, error)
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
	r.tenant_id AS tenant_id,
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
	TenantID         string `gorm:"column:tenant_id"`
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
		TenantID:        row.TenantID,
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
// candidateFilterColumns is the closed whitelist of filterable fields: the
// column mapping is fixed server-side, so user-supplied field names can never
// be spliced into SQL (SRS FR-JG-14).
var candidateFilterColumns = map[string]struct {
	column string
	ops    map[domain.CandidateFilterOp]bool
}{
	"network_domain_id": {"r.network_domain_id", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"status":            {"r.status", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"app_code":          {"r.app_code", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"biz_code":          {"r.biz_code", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"platform_code":     {"r.platform_code", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"env":               {"r.env", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"resource_category": {"r.resource_category", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"tenant_id":         {"r.tenant_id", map[domain.CandidateFilterOp]bool{domain.CandidateOpIn: true}},
	"cluster":           {"r.cluster", map[domain.CandidateFilterOp]bool{domain.CandidateOpEq: true, domain.CandidateOpContains: true}},
	"owner":             {"r.owner", map[domain.CandidateFilterOp]bool{domain.CandidateOpEq: true, domain.CandidateOpContains: true}},
}

// ValidateCandidateFilter reports an unsupported field / operator combination.
func ValidateCandidateFilter(filter domain.CandidateFilter) error {
	column, ok := candidateFilterColumns[filter.Field]
	if !ok {
		return domain.NewValidationErrorf("filters", "unsupported filter field %q", filter.Field)
	}
	if !column.ops[filter.Op] {
		return domain.NewValidationErrorf("filters", "operator %q is not supported for field %q", filter.Op, filter.Field)
	}
	if len(filter.Values) == 0 {
		return domain.NewValidationErrorf("filters", "field %q requires at least one value", filter.Field)
	}
	return nil
}

// ListCandidates keeps the legacy single-domain signature for existing callers.
func (r *GORMResourceReader) ListCandidates(ctx context.Context, query domain.CandidateQuery) ([]domain.ResourceRef, int64, error) {
	page, err := r.QueryCandidates(ctx, query)
	if err != nil {
		return nil, 0, err
	}
	return page.Refs, page.Total, nil
}

// QueryCandidates builds the candidate query from the composable filters.
func (r *GORMResourceReader) QueryCandidates(ctx context.Context, query domain.CandidateQuery) (domain.CandidatePage, error) {
	out := domain.CandidatePage{}
	category, subtypeColumn, subtypeValues, subtypeLike, err := candidateScope(query.MonitorType, query.Category)
	if err != nil {
		return out, err
	}

	statusFiltered := false
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).
			Table(resourceJoins).
			Where("r.deleted_at IS NULL").
			Where("r.resource_category = ?", string(category))
		if subtypeColumn != "" && len(subtypeValues) > 0 {
			if subtypeLike {
				// OS 家族：大小写不敏感的子串匹配（字典关键字 + 家族 token）
				clauses := make([]string, 0, len(subtypeValues))
				args := make([]any, 0, len(subtypeValues))
				for _, keyword := range subtypeValues {
					clauses = append(clauses, "LOWER("+subtypeColumn+") LIKE ?")
					args = append(args, likeKeywordPattern(keyword))
				}
				q = q.Where("("+strings.Join(clauses, " OR ")+")", args...)
			} else if len(subtypeValues) == 1 {
				q = q.Where(subtypeColumn+" = ?", subtypeValues[0])
			} else {
				q = q.Where(subtypeColumn+" IN ?", subtypeValues)
			}
		}
		if len(query.TenantIDs) > 0 {
			q = q.Where("r.tenant_id IN ?", query.TenantIDs)
		}
		if query.NetworkDomainID != "" {
			q = q.Where("r.network_domain_id = ?", query.NetworkDomainID)
		}
		for _, filter := range query.Filters {
			column, ok := candidateFilterColumns[filter.Field]
			if !ok || !column.ops[filter.Op] {
				continue // validated by the service; skip defensively
			}
			switch filter.Op {
			case domain.CandidateOpIn:
				q = q.Where(column.column+" IN ?", filter.Values)
			case domain.CandidateOpEq:
				q = q.Where(column.column+" = ?", filter.Values[0])
			case domain.CandidateOpContains:
				q = q.Where(column.column+" LIKE ?", "%"+filter.Values[0]+"%")
			}
			if filter.Field == "status" {
				statusFiltered = true
			}
		}
		// 与既有候选接口一致：未显式筛选状态时排除「维护中」。
		if !statusFiltered {
			q = q.Where("r.status <> ?", "maintenance")
		}
		if query.Keyword != "" {
			like := "%" + query.Keyword + "%"
			q = q.Where("(COALESCE(h.hostname, d.instance_ip, m.instance_ip, a.service_name, g.target_name, i.api_name, r.resource_id) LIKE ? "+
				"OR COALESCE(h.instance_ip, d.instance_ip, m.instance_ip, g.instance_ip, '') LIKE ?)", like, like)
		}
		return q
	}

	if err := build().Count(&out.Total).Error; err != nil {
		return out, fmt.Errorf("count resource candidates: %w", err)
	}

	// 分域计数：直接喂保存前的分域预览，避免前端二次聚合。
	var hits []struct {
		NetworkDomainID string `gorm:"column:network_domain_id"`
		Count           int64  `gorm:"column:count"`
	}
	if err := build().
		Select("r.network_domain_id AS network_domain_id, COUNT(*) AS count").
		Group("r.network_domain_id").
		Order("r.network_domain_id ASC").
		Scan(&hits).Error; err != nil {
		return out, fmt.Errorf("count resource candidates by domain: %w", err)
	}
	for _, hit := range hits {
		out.DomainHits = append(out.DomainHits, domain.DomainHit{
			NetworkDomainID: hit.NetworkDomainID, Count: hit.Count,
		})
	}

	if query.IDsOnly {
		maxIDs := query.MaxIDs
		if maxIDs <= 0 {
			maxIDs = 2000
		}
		var ids []string
		if err := build().
			Select("r.resource_id").
			Order("r.resource_id ASC").
			Limit(maxIDs+1).
			Pluck("r.resource_id", &ids).Error; err != nil {
			return out, fmt.Errorf("list candidate ids: %w", err)
		}
		if len(ids) > maxIDs {
			out.Truncated = true
			ids = ids[:maxIDs]
		}
		out.IDs = ids
		return out, nil
	}

	page, pageSize := normalizePage(query.Page, query.PageSize)
	if pageSize > 100 {
		pageSize = 100
	}
	var rows []resourceRow
	if err := build().
		Select(resourceSelect).
		Order("CASE WHEN r.status = 'online' THEN 0 ELSE 1 END, r.resource_id ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Scan(&rows).Error; err != nil {
		return out, fmt.Errorf("list resource candidates: %w", err)
	}
	out.Refs = make([]domain.ResourceRef, 0, len(rows))
	for i := range rows {
		out.Refs = append(out.Refs, rows[i].toDomain())
	}
	return out, nil
}

// GetMany loads resources by id (including offline ones) for validation.
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

func candidateScope(monitorType string, category domain.ResourceCategory) (domain.ResourceCategory, string, []string, bool, error) {
	if monitorType == "" {
		if category == domain.CategoryInterfaceService || category == domain.CategoryApplication {
			return category, "", nil, false, nil
		}
		return "", "", nil, false, domain.NewValidationError("monitor_type", "is required for standard jobs")
	}
	switch monitorType {
	case domain.MonitorTypeHostLinux:
		// OS 家族关键字来自内置 OS 字典（Ubuntu / RedHat Enterprise Linux / CentOS …），
		// 不能再写死 'linux' —— 否则规范化后的 os_type 永远匹配不到（v3 修复）。
		return domain.CategoryHost, "h.os_type", models.OSKeywordsForLinux(), true, nil
	case domain.MonitorTypeHostWindows:
		return domain.CategoryHost, "h.os_type", models.OSKeywordsForWindows(), true, nil
	case domain.MonitorTypeNPU:
		return domain.CategoryHost, "", nil, false, nil
	case domain.MonitorTypeMySQL:
		return domain.CategoryDatabase, "d.database_type", []string{"mysql"}, false, nil
	case domain.MonitorTypeRedis:
		return domain.CategoryDatabase, "d.database_type", []string{"redis"}, false, nil
	case domain.MonitorTypeKafka:
		return domain.CategoryMiddleware, "m.middleware_type", []string{"kafka"}, false, nil
	case domain.MonitorTypeElasticsearch:
		return domain.CategoryMiddleware, "m.middleware_type", []string{"elasticsearch"}, false, nil
	case domain.MonitorTypeNginx:
		return domain.CategoryMiddleware, "m.middleware_type", []string{"nginx"}, false, nil
	case domain.MonitorTypeApplicationHTTP:
		return domain.CategoryApplication, "", nil, false, nil
	case domain.MonitorTypeSNMP:
		return domain.CategoryGenericTarget, "", nil, false, nil
	default:
		return "", "", nil, false, domain.NewValidationErrorf("monitor_type", "unknown monitor type %q", monitorType)
	}
}

// likeKeywordPattern builds a LIKE pattern for a lowercased substring match.
func likeKeywordPattern(keyword string) string {
	return "%" + strings.ToLower(strings.TrimFunc(keyword, unicode.IsSpace)) + "%"
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
