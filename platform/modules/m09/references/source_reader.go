package references

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"

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
}

// NewGORMSourceReader constructs the reader.
func NewGORMSourceReader(db *gorm.DB) *GORMSourceReader {
	return &GORMSourceReader{db: db, resources: m01refs.NewResourceReader(db)}
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

	mappingPorts, exporterPorts, err := r.loadPorts(ctx)
	if err != nil {
		return configgen.Source{}, err
	}

	jobs := make([]configgen.Job, 0, len(rows))
	for _, row := range rows {
		var selected []string
		if strings.TrimSpace(row.SelectedInstanceIDs) != "" {
			if err := json.Unmarshal([]byte(row.SelectedInstanceIDs), &selected); err != nil {
				return configgen.Source{}, fmt.Errorf("decode selected instances of job %q: %w", row.JobName, err)
			}
		}
		refs, err := r.resources.GetMany(ctx, selected)
		if err != nil {
			return configgen.Source{}, err
		}
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
	return configgen.Source{NetworkDomainID: domainID, ZoneType: zoneRow.ZoneType, Jobs: jobs}, nil
}

// Fingerprint returns the newest source change across M07 resources and M01
// jobs (including soft deletions) plus global probe modules.
func (r *GORMSourceReader) Fingerprint(ctx context.Context, domainID string) (time.Time, error) {
	queries := []struct {
		table  string
		column string
		where  string
		args   []any
	}{
		{"resources", "updated_at", "network_domain_id = ? AND deleted_at IS NULL", []any{domainID}},
		{"m01_scrape_jobs", "updated_at", "network_domain_id = ? AND deleted_at IS NULL", []any{domainID}},
		{"m01_scrape_jobs", "deleted_at", "network_domain_id = ?", []any{domainID}},
		{"m01_probe_modules", "updated_at", "1 = 1", nil},
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
