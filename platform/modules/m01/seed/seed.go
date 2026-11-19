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

// defaultMappingSeed is the canonical monitor-type → exporter binding shipped
// with v3. Only the default implementation per type is seeded; additional
// implementations remain a user decision.
type defaultMappingSeed struct {
	MonitorType    string
	Exporter       string
	DefaultPort    int
	ScrapeInterval string
	ScrapeTimeout  string
}

// DefaultMappings returns the built-in monitor-type bindings.
func DefaultMappings() []defaultMappingSeed {
	return []defaultMappingSeed{
		{MonitorType: "host_linux", Exporter: "node-exporter", DefaultPort: 9100, ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{MonitorType: "host_windows", Exporter: "windows-exporter", DefaultPort: 9182, ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{MonitorType: "mysql", Exporter: "mysqld-exporter", DefaultPort: 9104, ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{MonitorType: "redis", Exporter: "redis-exporter", DefaultPort: 9121, ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{MonitorType: "kafka", Exporter: "kafka-exporter", DefaultPort: 9308, ScrapeInterval: "15s", ScrapeTimeout: "10s"},
		{MonitorType: "snmp", Exporter: "snmp-exporter", DefaultPort: 9116, ScrapeInterval: "15s", ScrapeTimeout: "10s"},
	}
}

// Run seeds the built-in M01 reference data. It is safe to call on every boot.
func Run(db *gorm.DB) error {
	if db == nil {
		return fmt.Errorf("seed m01: nil database connection")
	}
	ctx := context.Background()
	exporters := repository.NewExporterTemplateRepository(db)
	mappings := repository.NewMappingRepository(db)
	metrics := repository.NewMetricRepository(db)
	probes := repository.NewProbeModuleRepository(db)
	monitorTypes := repository.NewMonitorTypeRepository(db)

	if err := seedExporters(ctx, exporters); err != nil {
		return fmt.Errorf("seed m01 exporter templates: %w", err)
	}
	if err := seedMappings(ctx, exporters, mappings); err != nil {
		return fmt.Errorf("seed m01 default mappings: %w", err)
	}
	if err := seedMetrics(ctx, metrics); err != nil {
		return fmt.Errorf("seed m01 metric library: %w", err)
	}
	if err := seedProbeModules(ctx, probes); err != nil {
		return fmt.Errorf("seed m01 probe modules: %w", err)
	}
	if err := seedMonitorTypes(ctx, monitorTypes); err != nil {
		return fmt.Errorf("seed m01 monitor types: %w", err)
	}
	return nil
}

// seedMonitorTypes inserts the built-in monitor types (SRS Module_01 v1.3
// §5.6 FR-21). It is create-only: a type the user has edited or disabled is
// never overwritten on restart, so the registry stays user-owned data
// (NFR-11 idempotent seed).
func seedMonitorTypes(ctx context.Context, repo repository.MonitorTypeRepository) error {
	for _, entry := range domain.BuiltinMonitorTypeEntries() {
		if _, found, err := repo.Get(ctx, entry.Definition.Code); err != nil {
			return err
		} else if found {
			continue
		}
		if err := repo.Create(ctx, entry); err != nil {
			return fmt.Errorf("create built-in monitor type %q: %w", entry.Definition.Code, err)
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
			Name:                  tpl.Name,
			Version:               tpl.Version,
			DefaultPort:           tpl.DefaultPort,
			MetricsPath:           tpl.MetricsPath,
			Scheme:                domain.Scheme(tpl.Scheme),
			SupportedMonitorTypes: tpl.SupportedMonitorTypes,
			OS:                    tpl.OS,
			Arch:                  tpl.Arch,
			DownloadURL:           tpl.DownloadURL,
			Homepage:              tpl.Homepage,
			InstallGuide:          tpl.InstallGuide,
			Description:           tpl.Description,
			IsBuiltin:             true,
			Source:                domain.ExporterSource(tpl.Source),
		}
		if err := repo.Create(ctx, template); err != nil {
			return err
		}
	}
	return nil
}

func seedMappings(ctx context.Context, exporters *repository.GORMExporterTemplateRepository, mappings *repository.GORMMappingRepository) error {
	for _, item := range DefaultMappings() {
		exporter, err := exporters.GetByName(ctx, item.Exporter)
		if err != nil {
			return fmt.Errorf("resolve built-in exporter %q: %w", item.Exporter, err)
		}
		if _, found, err := mappings.FindByMonitorTypeAndExporter(ctx, item.MonitorType, exporter.ID); err != nil {
			return err
		} else if found {
			continue
		}
		hasDefault, err := mappings.HasDefault(ctx, item.MonitorType, "")
		if err != nil {
			return err
		}
		if hasDefault {
			// A user already chose another default; do not fight it.
			continue
		}
		mapping := &domain.Mapping{
			MonitorType:        item.MonitorType,
			ExporterTemplateID: exporter.ID,
			IsDefault:          true,
			DefaultPort:        item.DefaultPort,
			MetricsPath:        "/metrics",
			Scheme:             domain.SchemeHTTP,
			ScrapeInterval:     item.ScrapeInterval,
			ScrapeTimeout:      item.ScrapeTimeout,
			IsBuiltin:          true,
		}
		if err := mappings.Create(ctx, mapping); err != nil {
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
		for _, monitorType := range item.MonitorTypes {
			anchors = append(anchors, domain.MetricAnchor{
				MonitorType:    monitorType,
				SourceExporter: item.SourceExporter,
			})
		}
		metric := &domain.Metric{
			MetricName:   item.MetricName,
			MetricType:   domain.MetricType(item.MetricType),
			Help:         item.Help,
			Unit:         item.Unit,
			Labels:       item.Labels,
			MonitorTypes: anchors,
			Category:     item.Category,
			IsBuiltin:    true,
			Enabled:      true,
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
