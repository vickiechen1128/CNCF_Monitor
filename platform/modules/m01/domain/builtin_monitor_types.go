package domain

// Built-in monitor object types shipped with v3.
//
// They are ordinary registry entries: the seed writes them into
// m01_monitor_types / m01_monitor_type_rules on boot, and the same data is the
// in-memory default so read paths work before the first boot seeding (tests,
// fresh schema). Users may disable them but not delete them (FR-21); adding a
// new type is a data change and never touches this file (NFR-11).
//
// Registered rule IDs are stable so the seed can stay create-only and never
// duplicate rows on restart.

// Built-in monitor type codes.
const (
	MonitorTypeHostLinux       = "host_linux"
	MonitorTypeHostWindows     = "host_windows"
	MonitorTypeHostNPU         = "host_npu"
	MonitorTypeMySQL           = "mysql"
	MonitorTypeRedis           = "redis"
	MonitorTypeKafka           = "kafka"
	MonitorTypeElasticsearch   = "elasticsearch"
	MonitorTypeNginx           = "nginx"
	MonitorTypeApplicationHTTP = "application_http"
	MonitorTypeSNMP            = "snmp"
)

// BuiltinMonitorTypeEntries returns the built-in registry snapshot.
//
// host_npu is deliberately not derived from the operating system: NPU is an
// additional collection capability of a host, so it is expressed as
// ``has_npu = true`` and coexists with host_linux / host_windows (FR-10).
func BuiltinMonitorTypeEntries() []MonitorTypeEntry {
	return []MonitorTypeEntry{
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeHostLinux,
				Name:             "Linux 主机",
				ResourceCategory: CategoryHost,
				RuleLogic:        RuleLogicAll,
				Description:      "运行 Linux/Unix 操作系统的主机，由 node-exporter 采集 OS 指标",
				SortOrder:        10,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-host_linux-os_family", MonitorTypeCode: MonitorTypeHostLinux,
				Field: "os_family", Operator: RuleOpEq, Values: []string{"linux"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeHostWindows,
				Name:             "Windows 主机",
				ResourceCategory: CategoryHost,
				RuleLogic:        RuleLogicAll,
				Description:      "运行 Windows 操作系统的主机，由 windows-exporter 采集 OS 指标",
				SortOrder:        20,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-host_windows-os_family", MonitorTypeCode: MonitorTypeHostWindows,
				Field: "os_family", Operator: RuleOpEq, Values: []string{"windows"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeHostNPU,
				Name:             "NPU 主机",
				ResourceCategory: CategoryHost,
				RuleLogic:        RuleLogicAll,
				Description:      "带 NPU 芯片的主机；与操作系统类型正交，可与 host_linux / host_windows 同时命中",
				SortOrder:        30,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-host_npu-has_npu", MonitorTypeCode: MonitorTypeHostNPU,
				Field: "has_npu", Operator: RuleOpEq, Values: []string{"true"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeMySQL,
				Name:             "MySQL",
				ResourceCategory: CategoryDatabase,
				RuleLogic:        RuleLogicAll,
				Description:      "MySQL 数据库实例",
				SortOrder:        40,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-mysql-database_type", MonitorTypeCode: MonitorTypeMySQL,
				Field: "database_type", Operator: RuleOpEq, Values: []string{"mysql"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeRedis,
				Name:             "Redis",
				ResourceCategory: CategoryDatabase,
				RuleLogic:        RuleLogicAll,
				Description:      "Redis 数据库实例",
				SortOrder:        50,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-redis-database_type", MonitorTypeCode: MonitorTypeRedis,
				Field: "database_type", Operator: RuleOpEq, Values: []string{"redis"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeKafka,
				Name:             "Kafka",
				ResourceCategory: CategoryMiddleware,
				RuleLogic:        RuleLogicAll,
				Description:      "Kafka 中间件实例",
				SortOrder:        60,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-kafka-middleware_type", MonitorTypeCode: MonitorTypeKafka,
				Field: "middleware_type", Operator: RuleOpEq, Values: []string{"kafka"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeElasticsearch,
				Name:             "Elasticsearch",
				ResourceCategory: CategoryMiddleware,
				RuleLogic:        RuleLogicAll,
				Description:      "Elasticsearch 中间件实例",
				SortOrder:        70,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-elasticsearch-middleware_type", MonitorTypeCode: MonitorTypeElasticsearch,
				Field: "middleware_type", Operator: RuleOpEq, Values: []string{"elasticsearch"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeNginx,
				Name:             "Nginx",
				ResourceCategory: CategoryMiddleware,
				RuleLogic:        RuleLogicAll,
				Description:      "Nginx 中间件实例",
				SortOrder:        80,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-nginx-middleware_type", MonitorTypeCode: MonitorTypeNginx,
				Field: "middleware_type", Operator: RuleOpEq, Values: []string{"nginx"}, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeApplicationHTTP,
				Name:             "应用服务（HTTP）",
				ResourceCategory: CategoryApplication,
				RuleLogic:        RuleLogicAll,
				Description:      "应用服务类资源，采集健康检查端点指标",
				SortOrder:        90,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-application_http-always", MonitorTypeCode: MonitorTypeApplicationHTTP,
				Field: "service_name", Operator: RuleOpAlways, Priority: 10,
			}},
		},
		{
			Definition: MonitorTypeDefinition{
				Code:             MonitorTypeSNMP,
				Name:             "网络设备（SNMP）",
				ResourceCategory: CategoryGenericTarget,
				RuleLogic:        RuleLogicAll,
				Description:      "其他监控对象中的网络设备 / 自定义端点",
				SortOrder:        100,
				Enabled:          true,
				IsBuiltin:        true,
			},
			Rules: []MonitorTypeRule{{
				ID: "builtin-snmp-always", MonitorTypeCode: MonitorTypeSNMP,
				Field: "target_name", Operator: RuleOpAlways, Priority: 10,
			}},
		},
	}
}
