package references

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
)

// SourceReader builds the per-domain configgen source view from M07 v3
// resource tables and reports a change fingerprint.
//
// Interim scope (M01 v3 not landed yet): jobs are derived from M07 resources
// (host / database / middleware / generic_target). M01 ScrapeJob/Rule driven
// jobs and rules will be folded in when M01 v3 lands.
type SourceReader interface {
	BuildSource(ctx context.Context, domainID string) (configgen.Source, error)
	Fingerprint(ctx context.Context, domainID string) (time.Time, error)
	EdgeDomainIDs(ctx context.Context) ([]string, error)
}

// GORMSourceReader is the GORM-backed source reader.
type GORMSourceReader struct {
	db *gorm.DB
}

// NewGORMSourceReader constructs the reader.
func NewGORMSourceReader(db *gorm.DB) *GORMSourceReader {
	return &GORMSourceReader{db: db}
}

type sourceRow struct {
	ResourceID       string `gorm:"column:resource_id"`
	ResourceCategory string `gorm:"column:resource_category"`
	ScrapePort       int    `gorm:"column:scrape_port"`
	IP               string `gorm:"column:ip"`
	ExtPort          int    `gorm:"column:ext_port"`
	MetricsPath      string `gorm:"column:metrics_path"`
	Scheme           string `gorm:"column:scheme"`
	ExporterType     string `gorm:"column:exporter_type"`
}

// BuildSource returns the scrape jobs for a domain.
func (r *GORMSourceReader) BuildSource(ctx context.Context, domainID string) (configgen.Source, error) {
	var zoneRow struct {
		ZoneType string `gorm:"column:zone_type"`
	}
	if err := r.db.WithContext(ctx).Table("network_domains").
		Select("zone_type").Where("id = ?", domainID).Limit(1).Scan(&zoneRow).Error; err != nil {
		return configgen.Source{}, fmt.Errorf("load network domain %q zone_type: %w", domainID, err)
	}

	var rows []sourceRow
	err := r.db.WithContext(ctx).
		Table("resources AS r").
		Select(`r.resource_id AS resource_id,
			r.resource_category AS resource_category,
			r.scrape_port AS scrape_port,
			COALESCE(h.instance_ip, d.instance_ip, m.instance_ip, g.instance_ip, '') AS ip,
			COALESCE(d.port, m.port, g.port, 0) AS ext_port,
			COALESCE(g.metrics_path, '') AS metrics_path,
			COALESCE(g.scheme, '') AS scheme,
			COALESCE(g.exporter_type, '') AS exporter_type`).
		Joins("LEFT JOIN host_resources h ON h.resource_id = r.resource_id").
		Joins("LEFT JOIN database_resources d ON d.resource_id = r.resource_id").
		Joins("LEFT JOIN middleware_resources m ON m.resource_id = r.resource_id").
		Joins("LEFT JOIN generic_target_resources g ON g.resource_id = r.resource_id").
		Where("r.network_domain_id = ? AND r.deleted_at IS NULL AND r.status = ?", domainID, "online").
		Order("r.resource_category ASC, r.resource_id ASC").
		Scan(&rows).Error
	if err != nil {
		return configgen.Source{}, fmt.Errorf("load scrape targets for %q: %w", domainID, err)
	}

	jobsByName := map[string]*configgen.Job{}
	for _, row := range rows {
		job, ok := jobForRow(row)
		if !ok {
			continue
		}
		existing, ok := jobsByName[job.Name]
		if !ok {
			job.Targets = []configgen.Target{}
			jobsByName[job.Name] = &job
			existing = &job
		}
		instance := instanceAddress(row.IP, scrapePortFor(row))
		if instance == "" {
			continue
		}
		existing.Targets = append(existing.Targets, configgen.Target{Instance: instance})
	}

	names := make([]string, 0, len(jobsByName))
	for name, job := range jobsByName {
		if len(job.Targets) == 0 {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	jobs := make([]configgen.Job, 0, len(names))
	for _, name := range names {
		jobs = append(jobs, *jobsByName[name])
	}
	return configgen.Source{NetworkDomainID: domainID, ZoneType: zoneRow.ZoneType, Jobs: jobs}, nil
}

// Fingerprint returns the newest resource updated_at for a domain (zero when
// the domain has no resources yet).
func (r *GORMSourceReader) Fingerprint(ctx context.Context, domainID string) (time.Time, error) {
	var rows []struct {
		UpdatedAt *time.Time `gorm:"column:updated_at"`
	}
	err := r.db.WithContext(ctx).Table("resources").
		Select("updated_at").
		Where("network_domain_id = ? AND deleted_at IS NULL", domainID).
		Order("updated_at DESC").Limit(1).Find(&rows).Error
	if err != nil {
		return time.Time{}, fmt.Errorf("fingerprint network domain %q: %w", domainID, err)
	}
	if len(rows) == 0 || rows[0].UpdatedAt == nil {
		return time.Time{}, nil
	}
	return rows[0].UpdatedAt.UTC(), nil
}

// EdgeDomainIDs lists enabled edge domains (the config-sync watch set).
func (r *GORMSourceReader) EdgeDomainIDs(ctx context.Context) ([]string, error) {
	var ids []string
	err := r.db.WithContext(ctx).Table("network_domains").
		Where("deleted_at IS NULL AND domain_type = ? AND status = ?", "edge", "enabled").
		Order("id ASC").Pluck("id", &ids).Error
	if err != nil {
		return nil, fmt.Errorf("list edge domains for config sync: %w", err)
	}
	return ids, nil
}

func jobForRow(row sourceRow) (configgen.Job, bool) {
	switch row.ResourceCategory {
	case "host":
		return configgen.Job{Name: "node"}, true
	case "database":
		return configgen.Job{Name: "database"}, true
	case "middleware":
		return configgen.Job{Name: "middleware"}, true
	case "generic_target":
		name := strings.TrimSpace(row.ExporterType)
		if name == "" {
			name = "generic"
		}
		return configgen.Job{
			Name:        name,
			MetricsPath: strings.TrimSpace(row.MetricsPath),
			Scheme:      strings.TrimSpace(row.Scheme),
		}, true
	default:
		// application / interface_service need probe URLs (M01 blackbox jobs);
		// they are intentionally excluded until M01 v3 lands.
		return configgen.Job{}, false
	}
}

func scrapePortFor(row sourceRow) int {
	switch row.ResourceCategory {
	case "host":
		if row.ScrapePort > 0 {
			return row.ScrapePort
		}
		return 9100
	case "database", "middleware", "generic_target":
		if row.ExtPort > 0 {
			return row.ExtPort
		}
		return row.ScrapePort
	default:
		return row.ScrapePort
	}
}

func instanceAddress(ip string, port int) string {
	ip = strings.TrimSpace(ip)
	if ip == "" {
		return ""
	}
	if port <= 0 {
		return ip
	}
	return net.JoinHostPort(ip, strconv.Itoa(port))
}
