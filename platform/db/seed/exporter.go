package seed

import (
	"fmt"
	"strconv"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runExporters seeds the built-in ExporterTemplates and their default
// CITypeExporterMappings (is_default=true). Aligned with Module_01 §5.1/§5.2.
// Idempotent upsert: exporters by "name", mappings by
// "monitor_type = ? AND exporter_template_id = ?".
func runExporters(db *gorm.DB) error {
	// 1) Upsert built-in ExporterTemplates by unique name, capturing each
	// exporter's real primary key (BaseModel.ID) so CITypeExporterMapping can
	// reference the ExporterTemplate.ID instead of its name.
	exporterIDByName := make(map[string]string, len(models.BuiltinExporterTemplates()))
	for _, t := range models.BuiltinExporterTemplates() {
		exporter := t // take address of a loop-local copy
		if err := firstOrCreate(db, &exporter, "name = ?", exporter.Name); err != nil {
			return err
		}
		exporterIDByName[exporter.Name] = strconv.FormatUint(uint64(exporter.ID), 10)
	}

	// 2) Default CITypeExporterMappings keyed by monitor_type + exporter ID.
	type defaultMapping struct {
		monitorType      string
		exporter         string
		defaultPort      int
		scrapeInterval   string
		scrapeTimeout    string
	}
	mappings := []defaultMapping{
		{monitorType: "host_linux", exporter: "node-exporter", defaultPort: 9100, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "host_windows", exporter: "windows-exporter", defaultPort: 9182, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "mysql", exporter: "mysqld-exporter", defaultPort: 9104, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "redis", exporter: "redis-exporter", defaultPort: 9121, scrapeInterval: "15s", scrapeTimeout: "10s"},
	}
	for _, m := range mappings {
		exporterID, ok := exporterIDByName[m.exporter]
		if !ok {
			return fmt.Errorf("seed exporters: unknown built-in exporter %q", m.exporter)
		}
		row := &models.CITypeExporterMapping{
			MonitorType:        m.monitorType,
			ExporterTemplateID: exporterID, // references ExporterTemplate.ID
			IsDefault:          true,
			DefaultPort:        m.defaultPort,
			MetricsPath:        "/metrics",
			Scheme:             "http",
			ScrapeInterval:     m.scrapeInterval,
			ScrapeTimeout:      m.scrapeTimeout,
			IsBuiltin:          true,
		}
		if err := firstOrCreate(db, row, "monitor_type = ? AND exporter_template_id = ?", row.MonitorType, row.ExporterTemplateID); err != nil {
			return err
		}
	}
	return nil
}