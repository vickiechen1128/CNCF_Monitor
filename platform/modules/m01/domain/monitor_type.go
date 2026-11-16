package domain

import "strings"

// Fine-grained monitor types (监控对象类型). These mirror the legacy M01
// derivation table so v3 validation does not depend on the legacy models package.
const (
	MonitorTypeHostLinux       = "host_linux"
	MonitorTypeHostWindows     = "host_windows"
	MonitorTypeNPU             = "npu"
	MonitorTypeMySQL           = "mysql"
	MonitorTypeRedis           = "redis"
	MonitorTypeKafka           = "kafka"
	MonitorTypeElasticsearch   = "elasticsearch"
	MonitorTypeNginx           = "nginx"
	MonitorTypeApplicationHTTP = "application_http"
	MonitorTypeSNMP            = "snmp"
)

// ValidMonitorTypes returns the authoritative v3 monitor type set.
func ValidMonitorTypes() []string {
	return []string{
		MonitorTypeHostLinux,
		MonitorTypeHostWindows,
		MonitorTypeNPU,
		MonitorTypeMySQL,
		MonitorTypeRedis,
		MonitorTypeKafka,
		MonitorTypeElasticsearch,
		MonitorTypeNginx,
		MonitorTypeApplicationHTTP,
		MonitorTypeSNMP,
	}
}

// ValidMonitorType reports whether monitorType is known.
func ValidMonitorType(monitorType string) bool {
	value := strings.TrimSpace(monitorType)
	for _, candidate := range ValidMonitorTypes() {
		if candidate == value {
			return true
		}
	}
	return false
}

// ExporterSupportsMonitorType reports whether an exporter can collect a monitor
// type. An empty supported list means "no restriction".
func ExporterSupportsMonitorType(monitorType string, supported []string) bool {
	if len(supported) == 0 {
		return true
	}
	for _, candidate := range supported {
		if strings.TrimSpace(candidate) == monitorType {
			return true
		}
	}
	return false
}

// CategoryForMonitorType maps a fine-grained monitor type back to its coarse
// M07 resource category. It lets M01 validate that a label template belongs to
// the same category as the job/mapping.
func CategoryForMonitorType(monitorType string) (ResourceCategory, bool) {
	switch strings.TrimSpace(monitorType) {
	case MonitorTypeHostLinux, MonitorTypeHostWindows, MonitorTypeNPU:
		return CategoryHost, true
	case MonitorTypeMySQL, MonitorTypeRedis:
		return CategoryDatabase, true
	case MonitorTypeKafka, MonitorTypeElasticsearch, MonitorTypeNginx:
		return CategoryMiddleware, true
	case MonitorTypeApplicationHTTP:
		return CategoryApplication, true
	case MonitorTypeSNMP:
		return CategoryGenericTarget, true
	default:
		return "", false
	}
}
