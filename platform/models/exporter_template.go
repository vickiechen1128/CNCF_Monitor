package models

// ExporterSource represents the provenance of an exporter template.
type ExporterSource string

// Exporter source constants.
const (
	ExporterSourceOfficial   ExporterSource = "official"
	ExporterSourceThirdParty ExporterSource = "third_party"
	ExporterSourceInternal   ExporterSource = "internal"
)

// ExporterTemplate defines a lightweight "collector / exporter implementation"
// fragment, aligned with Module_01 §5.2.
type ExporterTemplate struct {
	BaseModel
	Name                  string         `gorm:"size:100;not null;uniqueIndex" json:"name"`
	Version               string         `gorm:"size:50" json:"version"`
	DefaultPort           int            `json:"default_port"`
	MetricsPath           string         `gorm:"size:200;not null" json:"metrics_path"` // 默认 /metrics
	Scheme                string         `gorm:"size:20;not null" json:"scheme"`        // 默认 http
	SupportedMonitorTypes []string       `gorm:"serializer:json" json:"supported_monitor_types"`
	OS                    string         `gorm:"size:50;not null" json:"os"`   // linux / windows / any
	Arch                  string         `gorm:"size:50;not null" json:"arch"` // amd64 / arm64 / any
	DownloadURL           string         `gorm:"size:1000" json:"download_url"`
	Homepage              string         `gorm:"size:1000" json:"homepage"`
	InstallGuide          string         `gorm:"type:text" json:"install_guide"`
	IsBuiltin             bool           `json:"is_builtin"`
	Source                ExporterSource `gorm:"size:20;not null" json:"source"`
}

// BuiltinExporterTemplates returns the pre-provisioned built-in exporters
// (node/mysqld/redis/windows), each anchored by its unique name for idempotent
// upsert.
func BuiltinExporterTemplates() []ExporterTemplate {
	return []ExporterTemplate{
		{Name: "node-exporter", Version: "1.6.1", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"host_linux", "host_windows"}, OS: "linux", Arch: "amd64", IsBuiltin: true, Source: ExporterSourceOfficial, InstallGuide: "https://github.com/prometheus/node_exporter"},
		{Name: "mysqld-exporter", Version: "0.15.1", DefaultPort: 9104, MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"mysql"}, OS: "linux", Arch: "amd64", IsBuiltin: true, Source: ExporterSourceOfficial, InstallGuide: "https://github.com/prometheus/mysqld_exporter"},
		{Name: "redis-exporter", Version: "1.59.0", DefaultPort: 9121, MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"redis"}, OS: "linux", Arch: "amd64", IsBuiltin: true, Source: ExporterSourceOfficial, InstallGuide: "https://github.com/oliver006/redis_exporter"},
		{Name: "windows-exporter", Version: "0.24.0", DefaultPort: 9182, MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"host_windows"}, OS: "windows", Arch: "amd64", IsBuiltin: true, Source: ExporterSourceOfficial, InstallGuide: "https://github.com/prometheus-community/windows_exporter"},
		{Name: "kafka-exporter", Version: "1.7.0", DefaultPort: 9308, MetricsPath: "/metrics", Scheme: "http", SupportedMonitorTypes: []string{"kafka"}, OS: "linux", Arch: "amd64", IsBuiltin: true, Source: ExporterSourceOfficial, InstallGuide: "https://github.com/danielqsj/kafka_exporter"},
		{Name: "snmp-exporter", Version: "0.26.0", DefaultPort: 9116, MetricsPath: "/snmp", Scheme: "http", SupportedMonitorTypes: []string{"snmp"}, OS: "linux", Arch: "amd64", IsBuiltin: true, Source: ExporterSourceOfficial, InstallGuide: "https://github.com/prometheus/snmp_exporter"},
	}
}
