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
		item := t
		var existing models.ExporterTemplate
		err := db.Where("name = ?", item.Name).First(&existing).Error
		switch err {
		case nil:
			// 内置采集器只读，种子为其权威数据源：存量库启动时对齐回填
			// （description/download_url/homepage/install_guide 等新增或修正字段），
			// 与 runZoneTypes 的存量对齐模式一致。
			existing.Version = item.Version
			existing.DefaultPort = item.DefaultPort
			existing.MetricsPath = item.MetricsPath
			existing.Scheme = item.Scheme
			existing.SupportedMonitorTypes = item.SupportedMonitorTypes
			existing.OS = item.OS
			existing.Arch = item.Arch
			existing.DownloadURL = item.DownloadURL
			existing.Homepage = item.Homepage
			existing.InstallGuide = item.InstallGuide
			existing.Description = item.Description
			existing.IsBuiltin = true
			existing.Source = item.Source
			if err := db.Save(&existing).Error; err != nil {
				return err
			}
			item = existing
		case gorm.ErrRecordNotFound:
			if err := db.Create(&item).Error; err != nil {
				return err
			}
		default:
			return err
		}
		exporterIDByName[item.Name] = strconv.FormatUint(uint64(item.ID), 10)
	}

	// 2) Default CITypeExporterMappings keyed by monitor_type + exporter ID.
	type defaultMapping struct {
		monitorType    string
		exporter       string
		defaultPort    int
		scrapeInterval string
		scrapeTimeout  string
	}
	mappings := []defaultMapping{
		{monitorType: "host_linux", exporter: "node-exporter", defaultPort: 9100, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "host_windows", exporter: "windows-exporter", defaultPort: 9182, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "mysql", exporter: "mysqld-exporter", defaultPort: 9104, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "redis", exporter: "redis-exporter", defaultPort: 9121, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "kafka", exporter: "kafka-exporter", defaultPort: 9308, scrapeInterval: "15s", scrapeTimeout: "10s"},
		{monitorType: "snmp", exporter: "snmp-exporter", defaultPort: 9116, scrapeInterval: "15s", scrapeTimeout: "10s"},
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
