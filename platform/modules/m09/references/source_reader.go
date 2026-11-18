package references

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	m01refs "github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
)

// SourceReader builds the per-domain configgen source view from M01 v3 scrape
// jobs and reports a change fingerprint.
//
// M01 owns the strategy source; M09 only reads `m01_scrape_jobs` and the M07
// resource tables. No M01 rendering code is invoked here.
type SourceReader interface {
	BuildSource(ctx context.Context, domainID string) (configgen.Source, error)
	Fingerprint(ctx context.Context, domainID string) (time.Time, error)
	EdgeDomainIDs(ctx context.Context) ([]string, error)
}

// GORMSourceReader is the GORM-backed source reader.
type GORMSourceReader struct {
	db        *gorm.DB
	resources *m01refs.GORMResourceReader

	// 端口映射是平台级低频配置，按 TTL 缓存：扇出 N 个域时不再每域重复查两张表。
	portsMu       sync.Mutex
	portsAt       time.Time
	mappingPorts  map[string]int
	exporterPorts map[string]int
}

// portsCacheTTL bounds how long the platform-level port mappings are reused.
// 30s matches the config-sync watcher cadence, so an admin edit takes effect on
// the next tick without querying the mapping tables for every domain.
const portsCacheTTL = 30 * time.Second

// NewGORMSourceReader constructs the reader.
func NewGORMSourceReader(db *gorm.DB) *GORMSourceReader {
	return &GORMSourceReader{db: db, resources: m01refs.NewResourceReader(db)}
}

// cachedPorts returns the default mapping ports and exporter port overrides,
// reusing the previous result until portsCacheTTL elapses.
func (r *GORMSourceReader) cachedPorts(ctx context.Context) (map[string]int, map[string]int, error) {
	r.portsMu.Lock()
	defer r.portsMu.Unlock()
	if r.mappingPorts != nil && time.Since(r.portsAt) < portsCacheTTL {
		return r.mappingPorts, r.exporterPorts, nil
	}
	mappingPorts, exporterPorts, err := r.loadPorts(ctx)
	if err != nil {
		return nil, nil, err
	}
	r.mappingPorts, r.exporterPorts, r.portsAt = mappingPorts, exporterPorts, time.Now()
	return mappingPorts, exporterPorts, nil
}

type jobSourceRow struct {
	JobName             string `gorm:"column:job_name"`
	JobType             string `gorm:"column:job_type"`
	MonitorType         string `gorm:"column:monitor_type"`
	ExporterTemplateID  string `gorm:"column:exporter_template_id"`
	BlackboxModule      string `gorm:"column:blackbox_module"`
	MetricsPath         string `gorm:"column:metrics_path"`
	Scheme              string `gorm:"column:scheme"`
	ScrapeInterval      string `gorm:"column:scrape_interval"`
	ScrapeTimeout       string `gorm:"column:scrape_timeout"`
	SelectedInstanceIDs string `gorm:"column:selected_instance_ids"`
}

type portRow struct {
	MonitorType string `gorm:"column:monitor_type"`
	DefaultPort int    `gorm:"column:default_port"`
}

type exporterPortRow struct {
	ID          string `gorm:"column:id"`
	DefaultPort int    `gorm:"column:default_port"`
}

// BuildSource returns the scrape jobs of one network domain.
func (r *GORMSourceReader) BuildSource(ctx context.Context, domainID string) (configgen.Source, error) {
	var zoneRow struct {
		ZoneType string `gorm:"column:zone_type"`
	}
	if err := r.db.WithContext(ctx).Table("network_domains").
		Select("zone_type").Where("id = ?", domainID).Limit(1).Scan(&zoneRow).Error; err != nil {
		return configgen.Source{}, fmt.Errorf("load network domain %q zone_type: %w", domainID, err)
	}

	var rows []jobSourceRow
	if err := r.db.WithContext(ctx).
		Table("m01_scrape_jobs").
		Select(`job_name, job_type, monitor_type, exporter_template_id, blackbox_module,
			metrics_path, scheme, scrape_interval, scrape_timeout, selected_instance_ids`).
		Where("network_domain_id = ? AND deleted_at IS NULL AND draft_status = ? AND enabled = ?",
			domainID, "ready", true).
		Order("job_name ASC").
		Scan(&rows).Error; err != nil {
		return configgen.Source{}, fmt.Errorf("load m01 scrape jobs for %q: %w", domainID, err)
	}

	// 先把所有 Job 的实例解码并取并集：原实现每个 Job 一次 GetMany（N+1），
	// 域内 Job 一多就是几十条重复查询，改为一次 IN 查询。
	selectedByJob := make([][]string, len(rows))
	allIDs := make([]string, 0, len(rows)*4)
	seen := make(map[string]struct{}, len(rows)*4)
	for i, row := range rows {
		var selected []string
		if strings.TrimSpace(row.SelectedInstanceIDs) != "" {
			if err := json.Unmarshal([]byte(row.SelectedInstanceIDs), &selected); err != nil {
				return configgen.Source{}, fmt.Errorf("decode selected instances of job %q: %w", row.JobName, err)
			}
		}
		selectedByJob[i] = selected
		for _, id := range selected {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			allIDs = append(allIDs, id)
		}
	}
	refs, err := r.resources.GetMany(ctx, allIDs)
	if err != nil {
		return configgen.Source{}, err
	}
	mappingPorts, exporterPorts, err := r.cachedPorts(ctx)
	if err != nil {
		return configgen.Source{}, err
	}

	jobs := make([]configgen.Job, 0, len(rows))
	for i, row := range rows {
		selected := selectedByJob[i]
		job := configgen.Job{
			Name:           row.JobName,
			MetricsPath:    row.MetricsPath,
			Scheme:         row.Scheme,
			Interval:       row.ScrapeInterval,
			Timeout:        row.ScrapeTimeout,
			BlackboxModule: row.BlackboxModule,
		}
		for _, id := range selected {
			ref, ok := refs[id]
			if !ok {
				continue
			}
			instance := ""
			if row.JobType == string(domain.JobTypeBlackbox) {
				instance = strings.TrimSpace(ref.TargetURL)
			} else {
				instance = domain.ResourceAddress(
					ref,
					mappingPorts[row.MonitorType],
					exporterPorts[row.ExporterTemplateID],
				)
			}
			if instance == "" {
				continue
			}
			job.Targets = append(job.Targets, configgen.Target{
				Instance: instance,
				Labels:   map[string]string{"resource_id": ref.ID},
			})
		}
		jobs = append(jobs, job)
	}
	sort.SliceStable(jobs, func(i, j int) bool { return jobs[i].Name < jobs[j].Name })
	modules, err := r.loadProbeModules(ctx)
	if err != nil {
		return configgen.Source{}, err
	}
	return configgen.Source{NetworkDomainID: domainID, ZoneType: zoneRow.ZoneType, Jobs: jobs, Modules: modules}, nil
}

// loadProbeModules returns the enabled blackbox module definitions. They are
// platform-global and rendered into every edge blackbox.yml.
func (r *GORMSourceReader) loadProbeModules(ctx context.Context) ([]models.BlackboxModule, error) {
	var rows []struct {
		Name    string `gorm:"column:name"`
		Content string `gorm:"column:content"`
	}
	if err := r.db.WithContext(ctx).
		Table("m01_probe_modules").
		Select("name, content").
		Where("enabled = ? AND deleted_at IS NULL", true).
		Order("name ASC").
		Scan(&rows).Error; err != nil {
		return nil, fmt.Errorf("load m01 probe modules: %w", err)
	}
	out := make([]models.BlackboxModule, 0, len(rows))
	for _, row := range rows {
		out = append(out, models.BlackboxModule{Name: row.Name, Content: row.Content, Enabled: true})
	}
	return out, nil
}

// Fingerprint returns the newest source change across M07 resources and M01
// jobs (including soft deletions) plus global probe modules.
//
// Soft deletes MUST be covered explicitly: GORM only writes deleted_at (it does
// not bump updated_at), so a filtered `updated_at` query cannot see them. Missing
// that makes a deletion invisible to the watcher and the domain keeps scraping a
// removed target until some unrelated change bumps the fingerprint. The rules
// fingerprint (`m01_monitoring_rules`) already covers both columns; keep these
// two in sync.
func (r *GORMSourceReader) Fingerprint(ctx context.Context, domainID string) (time.Time, error) {
	queries := []struct {
		table  string
		column string
		where  string
		args   []any
	}{
		{"resources", "updated_at", "network_domain_id = ? AND deleted_at IS NULL", []any{domainID}},
		{"resources", "deleted_at", "network_domain_id = ? AND deleted_at IS NOT NULL", []any{domainID}},
		{"m01_scrape_jobs", "updated_at", "network_domain_id = ? AND deleted_at IS NULL", []any{domainID}},
		{"m01_scrape_jobs", "deleted_at", "network_domain_id = ?", []any{domainID}},
		{"m01_probe_modules", "updated_at", "1 = 1", nil},
		{"m01_probe_modules", "deleted_at", "deleted_at IS NOT NULL", nil},
	}
	var newest time.Time
	for _, q := range queries {
		var row struct {
			Value *time.Time `gorm:"column:value"`
		}
		if err := r.db.WithContext(ctx).
			Table(q.table).
			Select(q.column+" AS value").
			Where(q.where, q.args...).
			Where(q.column + " IS NOT NULL").
			Order(q.column + " DESC").
			Limit(1).
			Scan(&row).Error; err != nil {
			return time.Time{}, fmt.Errorf("fingerprint %s.%s: %w", q.table, q.column, err)
		}
		if row.Value != nil && row.Value.After(newest) {
			newest = *row.Value
		}
	}
	return newest.UTC(), nil
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

func (r *GORMSourceReader) loadPorts(ctx context.Context) (map[string]int, map[string]int, error) {
	var mappings []portRow
	if err := r.db.WithContext(ctx).Table("m01_ci_type_exporter_mappings").
		Select("monitor_type, default_port").
		Where("is_default = ? AND deleted_at IS NULL", true).
		Scan(&mappings).Error; err != nil {
		return nil, nil, fmt.Errorf("load default mapping ports: %w", err)
	}
	mappingPorts := make(map[string]int, len(mappings))
	for _, row := range mappings {
		mappingPorts[row.MonitorType] = row.DefaultPort
	}

	var exporters []exporterPortRow
	if err := r.db.WithContext(ctx).Table("m01_exporter_templates").
		Select("id, default_port").Where("deleted_at IS NULL").
		Scan(&exporters).Error; err != nil {
		return nil, nil, fmt.Errorf("load exporter ports: %w", err)
	}
	exporterPorts := make(map[string]int, len(exporters))
	for _, row := range exporters {
		exporterPorts[row.ID] = row.DefaultPort
	}
	return mappingPorts, exporterPorts, nil
}
