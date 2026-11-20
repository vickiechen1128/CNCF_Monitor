// Package seed provisions the built-in M01 reference data: exporter templates,
// their default monitor-type mappings, the technical metric catalogue and the
// blackbox probe modules.
//
// Run is idempotent and create-only: existing rows are never overwritten, so a
// user edit or a later manual rename survives restarts. It is called by both
// startup modes after v3 migrations have been applied.
package seed

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	builtinseed "github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
)

// templateSeed is the canonical collection-template → exporter binding shipped
// with v3. Its exporter name is resolved from the built-in exporter pool; an
// empty name means "no exporter registered yet" and the template is seeded
// disabled so it cannot be used by a job until someone binds one (FR-21).
type templateSeed struct {
	Code           string
	Exporter       string
	DefaultPort    int
	MetricsPath    string
	ScrapeInterval string
	ScrapeTimeout  string
	Unbound        bool
}

// DefaultTemplates returns the built-in template bindings.
func DefaultTemplates() []templateSeed {
	return []templateSeed{
		{Code: "host_linux", Exporter: "node-exporter", DefaultPort: 9100, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "host_windows", Exporter: "windows-exporter", DefaultPort: 9182, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "host_npu", Unbound: true, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "mysql", Exporter: "mysqld-exporter", DefaultPort: 9104, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "redis", Exporter: "redis-exporter", DefaultPort: 9121, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "kafka", Exporter: "kafka-exporter", DefaultPort: 9308, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "elasticsearch", Unbound: true, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "nginx", Unbound: true, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "application_http", Unbound: true, MetricsPath: "/metrics", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{Code: "snmp", Exporter: "snmp-exporter", DefaultPort: 9116, MetricsPath: "/snmp", ScrapeInterval: "15s", ScrapeTimeout: "10s"},
	}
}

// Run seeds the built-in M01 reference data. It is safe to call on every boot.
func Run(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("seed m01: nil database connection")
	}
	ctx := context.Background()
	exporters := repository.NewExporterTemplateRepository(db)
	templates := repository.NewCollectionTemplateRepository(db)
	metrics := repository.NewMetricRepository(db)
	probes := repository.NewProbeModuleRepository(db)

	if err := seedExporters(ctx, exporters); err != nil {
		return fmt.Errorf("seed m01 exporter templates: %w", err)
	}
	if err := seedCollectionTemplates(ctx, exporters, templates); err != nil {
		return fmt.Errorf("seed m01 collection templates: %w", err)
	}
	if err := seedMetrics(ctx, metrics); err != nil {
		return fmt.Errorf("seed m01 metric library: %w", err)
	}
	if err := seedProbeModules(ctx, probes); err != nil {
		return fmt.Errorf("seed m01 probe modules: %w", err)
	}
	return nil
}

// seedCollectionTemplates inserts the built-in collection templates
// (SRS Module_01 v1.5 FR-21). It is create-only: a template the user edited or
// disabled is never overwritten on restart (NFR-11 idempotent seed).
func seedCollectionTemplates(ctx context.Context, exporters *repository.GORMExporterTemplateRepository, templates *repository.GORMCollectionTemplateRepository) error {
	for _, item := range DefaultTemplates() {
		builtin, ok := domain.BuiltinCollectionTemplate(item.Code)
		if !ok {
			continue
		}
		if _, found, err := templates.Find(ctx, item.Code); err != nil {
			return err
		} else if found {
			continue
		}
		template := builtin
		template.MetricsPath = item.MetricsPath
		template.ScrapeInterval = item.ScrapeInterval
		template.ScrapeTimeout = item.ScrapeTimeout
		template.Enabled = true
		if item.Exporter != "" {
			exporter, err := exporters.GetByName(ctx, item.Exporter)
			if err != nil {
				return fmt.Errorf("resolve built-in exporter %q: %w", item.Exporter, err)
			}
			template.ExporterTemplateID = exporter.ID
			template.DefaultPort = item.DefaultPort
		}
		if item.Unbound {
			// No exporter registered yet: keep the recipe visible but unusable
			// until an administrator binds an implementation.
			template.Enabled = false
			template.Description = template.Description + "（尚未绑定采集实现，登记后在采集模板页绑定并启用）"
		}
		if err := templates.Create(ctx, &template); err != nil {
			return err
		}
	}
	return nil
}

func seedExporters(ctx context.Context, repo *repository.GORMExporterTemplateRepository) error {
	for _, tpl := range models.BuiltinExporterTemplates() {
		if _, err := repo.GetByName(ctx, tpl.Name); err == nil {
			continue
		} else if !isNotFound(err) {
			return err
		}
		template := &domain.ExporterTemplate{
			Name:         tpl.Name,
			Version:      tpl.Version,
			DefaultPort:  tpl.DefaultPort,
			MetricsPath:  tpl.MetricsPath,
			Scheme:       domain.Scheme(tpl.Scheme),
			OS:           tpl.OS,
			Arch:         tpl.Arch,
			DownloadURL:  tpl.DownloadURL,
			Homepage:     tpl.Homepage,
			InstallGuide: tpl.InstallGuide,
			Description:  tpl.Description,
			IsBuiltin:    true,
			Source:       domain.ExporterSource(tpl.Source),
		}
		if err := repo.Create(ctx, template); err != nil {
			return err
		}
	}
	return nil
}

func seedMetrics(ctx context.Context, repo *repository.GORMMetricRepository) error {
	for _, item := range builtinseed.BuiltinMetricLibrary() {
		if _, found, err := repo.GetBuiltinByName(ctx, item.MetricName); err != nil {
			return err
		} else if found {
			continue
		}
		anchors := make([]domain.MetricAnchor, 0, len(item.MonitorTypes))
		for _, templateCode := range item.MonitorTypes {
			anchors = append(anchors, domain.MetricAnchor{
				TemplateCode:   templateCode,
				SourceExporter: item.SourceExporter,
			})
		}
		metric := &domain.Metric{
			MetricName:          item.MetricName,
			MetricType:          domain.MetricType(item.MetricType),
			Help:                item.Help,
			Unit:                item.Unit,
			Labels:              item.Labels,
			CollectionTemplates: anchors,
			Category:            item.Category,
			IsBuiltin:           true,
			Enabled:             true,
		}
		if err := repo.Create(ctx, metric); err != nil {
			return err
		}
	}
	return nil
}

func seedProbeModules(ctx context.Context, repo *repository.GORMProbeModuleRepository) error {
	for _, module := range models.DefaultBlackboxModules() {
		if _, err := repo.GetByName(ctx, module.Name); err == nil {
			continue
		} else if !isNotFound(err) {
			return err
		}
		probe := &domain.ProbeModule{
			Name:      module.Name,
			Content:   module.Content,
			IsBuiltin: true,
			Enabled:   module.Enabled,
		}
		if err := repo.Create(ctx, probe); err != nil {
			return err
		}
	}
	return nil
}

func isNotFound(err error) bool {
	var nf *domain.NotFoundError
	return errors.As(err, &nf)
}
