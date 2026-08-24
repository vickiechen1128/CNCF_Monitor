package seed

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// builtinMetricSeed 描述一条内置技术指标（Module_01 §5.3 MVP 指标库最小集）。
type builtinMetricSeed struct {
	MonitorTypes   []string
	SourceExporter string
	Category       string
	MetricName     string
	MetricType     models.MetricType
	Help           string
	Unit           string
	Labels         []string
}

// BuiltinMetricLibrary 返回内置技术指标库最小集，按 monitor_type 组织
// （Module_01 §5.3）：host_linux / host_windows / mysql / redis / kafka / snmp /
// application_http（含拨测三件套）。each 幂等 upsert：
// 以 metric_name 为业务唯一键。
func BuiltinMetricLibrary() []builtinMetricSeed {
	return []builtinMetricSeed{
		// host_linux（node-exporter）
		{MonitorTypes: []string{"host_linux"}, SourceExporter: "node-exporter", Category: "cpu", MetricName: "node_cpu_usage", MetricType: models.MetricTypeGauge, Help: "CPU 使用率", Unit: "percent", Labels: []string{"cpu", "mode"}},
		{MonitorTypes: []string{"host_linux"}, SourceExporter: "node-exporter", Category: "memory", MetricName: "node_memory_usage", MetricType: models.MetricTypeGauge, Help: "内存使用率", Unit: "percent", Labels: []string{}},
		{MonitorTypes: []string{"host_linux"}, SourceExporter: "node-exporter", Category: "disk", MetricName: "node_disk_usage", MetricType: models.MetricTypeGauge, Help: "磁盘使用率", Unit: "percent", Labels: []string{"mountpoint"}},
		{MonitorTypes: []string{"host_linux"}, SourceExporter: "node-exporter", Category: "network", MetricName: "node_network_speed", MetricType: models.MetricTypeGauge, Help: "网络吞吐", Unit: "bytes", Labels: []string{"device"}},
		// host_windows（windows-exporter）
		{MonitorTypes: []string{"host_windows"}, SourceExporter: "windows-exporter", Category: "cpu", MetricName: "windows_cpu_usage", MetricType: models.MetricTypeGauge, Help: "Windows CPU 使用率", Unit: "percent", Labels: []string{}},
		{MonitorTypes: []string{"host_windows"}, SourceExporter: "windows-exporter", Category: "memory", MetricName: "windows_memory_usage", MetricType: models.MetricTypeGauge, Help: "Windows 内存使用率", Unit: "percent", Labels: []string{}},
		// mysql（mysqld-exporter）
		{MonitorTypes: []string{"mysql"}, SourceExporter: "mysqld-exporter", Category: "connection", MetricName: "mysql_connections", MetricType: models.MetricTypeGauge, Help: "MySQL 连接数", Unit: "connections", Labels: []string{"host"}},
		{MonitorTypes: []string{"mysql"}, SourceExporter: "mysqld-exporter", Category: "slow_query", MetricName: "mysql_slow_queries", MetricType: models.MetricTypeCounter, Help: "MySQL 慢查询次数", Unit: "events", Labels: []string{}},
		// redis（redis-exporter）
		{MonitorTypes: []string{"redis"}, SourceExporter: "redis-exporter", Category: "memory", MetricName: "redis_memory_usage", MetricType: models.MetricTypeGauge, Help: "Redis 内存使用率", Unit: "percent", Labels: []string{"addr"}},
		{MonitorTypes: []string{"redis"}, SourceExporter: "redis-exporter", Category: "connection", MetricName: "redis_connected_clients", MetricType: models.MetricTypeGauge, Help: "Redis 客户端连接数", Unit: "connections", Labels: []string{"addr"}},
		// kafka（kafka-exporter）
		{MonitorTypes: []string{"kafka"}, SourceExporter: "kafka-exporter", Category: "partition", MetricName: "kafka_partition_count", MetricType: models.MetricTypeGauge, Help: "Kafka 分区数", Unit: "partitions", Labels: []string{"topic"}},
		{MonitorTypes: []string{"kafka"}, SourceExporter: "kafka-exporter", Category: "consumer", MetricName: "kafka_consumer_lag", MetricType: models.MetricTypeGauge, Help: "Kafka 消费组延迟", Unit: "events", Labels: []string{"topic", "group"}},
		// snmp（snmp-exporter）
		{MonitorTypes: []string{"snmp"}, SourceExporter: "snmp-exporter", Category: "interface", MetricName: "snmp_interface_traffic", MetricType: models.MetricTypeGauge, Help: "SNMP 接口流量", Unit: "bytes", Labels: []string{"ifname"}},
		{MonitorTypes: []string{"snmp"}, SourceExporter: "snmp-exporter", Category: "status", MetricName: "snmp_device_status", MetricType: models.MetricTypeGauge, Help: "SNMP 设备状态", Unit: "", Labels: []string{}},
		// application_http（HTTP 抓取）——含拨测三件套
		{MonitorTypes: []string{"application_http"}, SourceExporter: "", Category: "http", MetricName: "app_http_requests_total", MetricType: models.MetricTypeCounter, Help: "业务微服务请求总量", Unit: "requests", Labels: []string{"path", "method"}},
		{MonitorTypes: []string{"application_http"}, SourceExporter: "", Category: "runtime", MetricName: "go_goroutines", MetricType: models.MetricTypeGauge, Help: "Go 协程数", Unit: "", Labels: []string{}},
		{MonitorTypes: []string{"application_http"}, SourceExporter: "blackbox-exporter", Category: "probe", MetricName: "probe_success", MetricType: models.MetricTypeGauge, Help: "拨测成功", Unit: "", Labels: []string{}},
		{MonitorTypes: []string{"application_http"}, SourceExporter: "blackbox-exporter", Category: "probe", MetricName: "probe_duration_seconds", MetricType: models.MetricTypeGauge, Help: "拨测耗时", Unit: "seconds", Labels: []string{}},
		{MonitorTypes: []string{"application_http"}, SourceExporter: "blackbox-exporter", Category: "probe", MetricName: "probe_http_status_code", MetricType: models.MetricTypeGauge, Help: "拨测 HTTP 状态码", Unit: "", Labels: []string{}},
	}
}

// runMetricLibrary 幂等 upsert 内置技术指标库（is_builtin=true）。以 metric_name
// 为唯一键（MVP 静态内置，用户扩展走 API 时 is_builtin=false）。
func runMetricLibrary(db *gorm.DB) error {
	for _, m := range BuiltinMetricLibrary() {
		anchors := make([]models.ExporterMetricAnchor, 0, len(m.MonitorTypes))
		for _, mt := range m.MonitorTypes {
			anchors = append(anchors, models.ExporterMetricAnchor{MonitorType: mt, SourceExporter: m.SourceExporter})
		}
		row := &models.ExporterMetricLibrary{
			MetricName:   m.MetricName,
			MetricType:   m.MetricType,
			Help:         m.Help,
			Unit:         m.Unit,
			Labels:       m.Labels,
			MonitorTypes: anchors,
			Category:     m.Category,
			IsBuiltin:    true,
			Enabled:      true,
		}
		if err := firstOrCreate(db, row, "metric_name = ? AND is_builtin = ?", row.MetricName, true); err != nil {
			return err
		}
	}
	return nil
}
