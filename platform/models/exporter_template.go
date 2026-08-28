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
	Description           string         `gorm:"type:text" json:"description"`
	IsBuiltin             bool           `json:"is_builtin"`
	Source                ExporterSource `gorm:"size:20;not null" json:"source"`
}

// BuiltinExporterTemplates returns the pre-provisioned built-in exporters
// (node/mysqld/redis/windows/kafka/snmp), each anchored by its unique name for
// idempotent upsert. Built-in rows are read-only; this slice is their canonical
// data source (下载地址/官方文档/安装指南/描述 etc.), seed 每次启动对齐回填。
func BuiltinExporterTemplates() []ExporterTemplate {
	return []ExporterTemplate{
		{
			Name: "node-exporter", Version: "1.6.1", DefaultPort: 9100, MetricsPath: "/metrics", Scheme: "http",
			SupportedMonitorTypes: []string{"host_linux", "host_windows"}, OS: "linux", Arch: "amd64",
			DownloadURL:  "https://github.com/prometheus/node_exporter/releases",
			Homepage:     "https://github.com/prometheus/node_exporter",
			InstallGuide: "1. 下载对应平台二进制；2. 解压并复制到 /usr/local/bin；3. systemd 托管并暴露 9100 端口。",
			Description:  "Prometheus 官方主机指标采集器，暴露 CPU / 内存 / 磁盘 / 网络等主机指标。",
			IsBuiltin:    true, Source: ExporterSourceOfficial,
		},
		{
			Name: "mysqld-exporter", Version: "0.15.1", DefaultPort: 9104, MetricsPath: "/metrics", Scheme: "http",
			SupportedMonitorTypes: []string{"mysql"}, OS: "linux", Arch: "amd64",
			DownloadURL:  "https://github.com/prometheus/mysqld_exporter/releases",
			Homepage:     "https://github.com/prometheus/mysqld_exporter",
			InstallGuide: "1. 创建最小权限监控账号；2. 配置 DSN 环境变量；3. 暴露 9104 端口并提供 /metrics。",
			Description:  "Prometheus 官方 MySQL 指标采集器，暴露连接数、慢查询等 MySQL 运行指标。",
			IsBuiltin:    true, Source: ExporterSourceOfficial,
		},
		{
			Name: "redis-exporter", Version: "1.59.0", DefaultPort: 9121, MetricsPath: "/metrics", Scheme: "http",
			SupportedMonitorTypes: []string{"redis"}, OS: "linux", Arch: "amd64",
			DownloadURL:  "https://github.com/oliver006/redis_exporter/releases",
			Homepage:     "https://github.com/oliver006/redis_exporter",
			InstallGuide: "1. 配置 REDIS_ADDR 指向目标实例；2. 暴露 9121 端口；3. 支持 Redis 3.x+ 与 Sentinel/Cluster。",
			Description:  "Redis 指标采集器，暴露内存使用率、客户端连接数等 Redis 运行指标。",
			IsBuiltin:    true, Source: ExporterSourceThirdParty,
		},
		{
			Name: "windows-exporter", Version: "0.24.0", DefaultPort: 9182, MetricsPath: "/metrics", Scheme: "http",
			SupportedMonitorTypes: []string{"host_windows"}, OS: "windows", Arch: "amd64",
			DownloadURL:  "https://github.com/prometheus-community/windows_exporter/releases",
			Homepage:     "https://github.com/prometheus-community/windows_exporter",
			InstallGuide: "1. 下载 msi 安装包；2. 默认监听 9182 端口；3. 通过 collector.textfile 扩展自定义指标。",
			Description:  "Prometheus 社区 Windows 指标采集器，暴露 Windows 主机 CPU / 内存 / 磁盘指标。",
			IsBuiltin:    true, Source: ExporterSourceThirdParty,
		},
		{
			Name: "kafka-exporter", Version: "1.7.0", DefaultPort: 9308, MetricsPath: "/metrics", Scheme: "http",
			SupportedMonitorTypes: []string{"kafka"}, OS: "linux", Arch: "amd64",
			DownloadURL:  "https://github.com/danielqsj/kafka_exporter/releases",
			Homepage:     "https://github.com/danielqsj/kafka_exporter",
			InstallGuide: "1. 指定 kafka.server 参数连接集群；2. 暴露 9308 端口；3. 输出分区数与消费组延迟指标。",
			Description:  "Kafka 指标采集器，暴露分区数、消费组延迟等 Kafka 运行指标。",
			IsBuiltin:    true, Source: ExporterSourceThirdParty,
		},
		{
			Name: "snmp-exporter", Version: "0.26.0", DefaultPort: 9116, MetricsPath: "/snmp", Scheme: "http",
			SupportedMonitorTypes: []string{"snmp"}, OS: "linux", Arch: "amd64",
			DownloadURL:  "https://github.com/prometheus/snmp_exporter/releases",
			Homepage:     "https://github.com/prometheus/snmp_exporter",
			InstallGuide: "1. 按 MIB 生成 snmp.yml 配置文件；2. 暴露 9116 端口；3. 通过 module+target 参数拨测设备。",
			Description:  "Prometheus 官方 SNMP 指标采集器，基于 MIB 配置采集网络设备指标。",
			IsBuiltin:    true, Source: ExporterSourceOfficial,
		},
	}
}
