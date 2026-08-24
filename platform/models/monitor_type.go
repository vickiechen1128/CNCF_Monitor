package models

import (
	"strings"
)

// 细粒度监控对象类型（monitor_type）明细常量。这是由资源类别 + 子类型经
// MONITOR_TYPE_DERIVATION_MAP 推导出的策略维度（Module_01 §5.1 / §10）。
const (
	MonitorTypeHostLinux       = "host_linux"
	MonitorTypeHostWindows     = "host_windows"
	MonitorTypeMySQL           = "mysql"
	MonitorTypeRedis           = "redis"
	MonitorTypeKafka           = "kafka"
	MonitorTypeElasticsearch   = "elasticsearch"
	MonitorTypeNginx           = "nginx"
	MonitorTypeApplicationHTTP = "application_http"
	MonitorTypeSNMP            = "snmp"
)

// ValidMonitorTypes returns the authoritative list of fine-grained monitor
// types supported in MVP (不含达梦 dm8，v0.4+ 随 CMDB 映射进入)。
func ValidMonitorTypes() []string {
	return []string{
		MonitorTypeHostLinux,
		MonitorTypeHostWindows,
		MonitorTypeMySQL,
		MonitorTypeRedis,
		MonitorTypeKafka,
		MonitorTypeElasticsearch,
		MonitorTypeNginx,
		MonitorTypeApplicationHTTP,
		MonitorTypeSNMP,
	}
}

// ValidMonitorType reports whether mt is a known monitor type.
func ValidMonitorType(mt string) bool {
	for _, v := range ValidMonitorTypes() {
		if v == strings.TrimSpace(mt) {
			return true
		}
	}
	return false
}

// monitorKey builds the "category:subtype" lookup key for MONITOR_TYPE_DERIVATION_MAP.
func monitorKey(category ResourceCategory, subtype string) string {
	return string(category) + ":" + strings.ToLower(strings.TrimSpace(subtype))
}

// MONITOR_TYPE_DERIVATION_MAP 是监控对象类型推导表（名字即语义：这是由资源类别 +
// 子类型推导出来的策略维度，不回写 CMDB，Module_01 §5.1）。键为
// "resource_category:subtype"，值为 monitor_type；host 的 os_type
// (linux/unix/windows) 用 Image 列承载。不含 dm8（v0.4+）。
var MONITOR_TYPE_DERIVATION_MAP = map[string]string{
	monitorKey(ResourceCategoryHost, "linux"):               MonitorTypeHostLinux,
	monitorKey(ResourceCategoryHost, "unix"):                MonitorTypeHostLinux,
	monitorKey(ResourceCategoryHost, "windows"):             MonitorTypeHostWindows,
	monitorKey(ResourceCategoryDatabase, "mysql"):           MonitorTypeMySQL,
	monitorKey(ResourceCategoryDatabase, "redis"):           MonitorTypeRedis,
	monitorKey(ResourceCategoryMiddleware, "kafka"):         MonitorTypeKafka,
	monitorKey(ResourceCategoryMiddleware, "elasticsearch"): MonitorTypeElasticsearch,
	monitorKey(ResourceCategoryMiddleware, "nginx"):         MonitorTypeNginx,
	monitorKey(ResourceCategoryApplication, ""):             MonitorTypeApplicationHTTP,
	monitorKey(ResourceCategoryGenericTarget, ""):           MonitorTypeSNMP,
}

// MonitorTypeDerivation 描述由 monitor_type 推导候选实例查询所需的资源类别与子类型
// 约束，供「采集 Job」实例候选查询收敛（Module_01 §5.4 实例候选自动收敛）。
type MonitorTypeDerivation struct {
	Category     ResourceCategory
	SubtypeField string   // 细分子类型字段：os_type / database_type / middleware_type；application/generic_target 为空（不限）
	Subtype      string   // 期望子类型值（SubtypeField 非空时生效）
	OSKeywords   []string // 仅 category=host 生效：os_type 无独立列，按 Image 关键字匹配
}

// DeriveMonitorType 由资源类别 + 细扇类型推导 monitor_type（module_key 查询推导表）。
func DeriveMonitorType(category ResourceCategory, subtype string) (string, bool) {
	mt, ok := MONITOR_TYPE_DERIVATION_MAP[monitorKey(category, subtype)]
	return mt, ok
}

// DeriveResourceFilter 由 monitor_type 推导候选实例查询约束（category + 子类型过滤）。
func DeriveResourceFilter(monitorType string) (MonitorTypeDerivation, bool) {
	mt := strings.TrimSpace(monitorType)
	switch mt {
	case MonitorTypeHostLinux:
		// os 家族关键字由内置 OS 字典推导（os_dict.go）：linux 家族规范名 + 兜底 token。
		return MonitorTypeDerivation{Category: ResourceCategoryHost, SubtypeField: "os_type", OSKeywords: OSKeywordsForLinux()}, true
	case MonitorTypeHostWindows:
		return MonitorTypeDerivation{Category: ResourceCategoryHost, SubtypeField: "os_type", OSKeywords: OSKeywordsForWindows()}, true
	case MonitorTypeMySQL:
		return MonitorTypeDerivation{Category: ResourceCategoryDatabase, SubtypeField: "database_type", Subtype: "mysql"}, true
	case MonitorTypeRedis:
		return MonitorTypeDerivation{Category: ResourceCategoryDatabase, SubtypeField: "database_type", Subtype: "redis"}, true
	case MonitorTypeKafka:
		return MonitorTypeDerivation{Category: ResourceCategoryMiddleware, SubtypeField: "middleware_type", Subtype: "kafka"}, true
	case MonitorTypeElasticsearch:
		return MonitorTypeDerivation{Category: ResourceCategoryMiddleware, SubtypeField: "middleware_type", Subtype: "elasticsearch"}, true
	case MonitorTypeNginx:
		return MonitorTypeDerivation{Category: ResourceCategoryMiddleware, SubtypeField: "middleware_type", Subtype: "nginx"}, true
	case MonitorTypeApplicationHTTP:
		return MonitorTypeDerivation{Category: ResourceCategoryApplication}, true
	case MonitorTypeSNMP:
		return MonitorTypeDerivation{Category: ResourceCategoryGenericTarget}, true
	}
	return MonitorTypeDerivation{}, false
}

// hostOSMatches reports whether a host Image (os_type) matches the given
// monitor-type derivation OS keywords.
func (d MonitorTypeDerivation) hostOSMatches(image string) bool {
	lower := strings.ToLower(image)
	for _, kw := range d.OSKeywords {
		if strings.Contains(lower, strings.ToLower(kw)) {
			return true
		}
	}
	return false
}
