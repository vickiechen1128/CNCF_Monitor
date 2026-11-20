package domain

// Built-in collection templates shipped with the v3 rewrite.
//
// They are ordinary templates: the seed writes them into
// m01_collection_templates on boot, and this snapshot is the in-memory default
// so read paths work before the first boot seeding (tests, fresh schema). Users
// may disable them but not delete them (FR-21); adding a template is a data
// change and never touches this file (NFR-11).
//
// DefaultSelector is a wizard prefill only: it reproduces the rules of the
// retired "monitor object type" model so the first job of each kind starts from
// the same candidate set it used to have.

// Built-in collection template codes.
const (
	TemplateHostLinux       = "host_linux"
	TemplateHostWindows     = "host_windows"
	TemplateHostNPU         = "host_npu"
	TemplateMySQL           = "mysql"
	TemplateRedis           = "redis"
	TemplateKafka           = "kafka"
	TemplateElasticsearch   = "elasticsearch"
	TemplateNginx           = "nginx"
	TemplateApplicationHTTP = "application_http"
	TemplateSNMP            = "snmp"
)

// BuiltinCollectionTemplates returns the built-in template snapshot.
//
// host_npu is deliberately orthogonal to the operating system: NPU is an extra
// collection capability, expressed as a default selector “has_npu = true“ that
// coexists with host_linux / host_windows (FR-10 / FR-23).
func BuiltinCollectionTemplates() []CollectionTemplate {
	all := Selector{Logic: RuleLogicAll}
	return []CollectionTemplate{
		{
			Code: TemplateHostLinux, Name: "Linux 主机采集",
			ResourceCategory: CategoryHost, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "运行 Linux/Unix 操作系统的主机，由 node-exporter 采集 OS 指标",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "os_family", Operator: RuleOpEq, Values: []string{"linux"}}}},
			SortOrder:       10, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateHostWindows, Name: "Windows 主机采集",
			ResourceCategory: CategoryHost, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "运行 Windows 操作系统的主机，由 windows-exporter 采集 OS 指标",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "os_family", Operator: RuleOpEq, Values: []string{"windows"}}}},
			SortOrder:       20, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateHostNPU, Name: "NPU 主机采集",
			ResourceCategory: CategoryHost, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "带 NPU 芯片的主机；与操作系统类型正交，可与 Linux/Windows 主机采集同时命中",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "has_npu", Operator: RuleOpEq, Values: []string{"true"}}}},
			SortOrder:       30, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateMySQL, Name: "MySQL 采集",
			ResourceCategory: CategoryDatabase, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "MySQL 数据库实例",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "database_type", Operator: RuleOpEq, Values: []string{"mysql"}}}},
			SortOrder:       40, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateRedis, Name: "Redis 采集",
			ResourceCategory: CategoryDatabase, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "Redis 数据库实例",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "database_type", Operator: RuleOpEq, Values: []string{"redis"}}}},
			SortOrder:       50, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateKafka, Name: "Kafka 采集",
			ResourceCategory: CategoryMiddleware, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "Kafka 中间件实例",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "middleware_type", Operator: RuleOpEq, Values: []string{"kafka"}}}},
			SortOrder:       60, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateElasticsearch, Name: "Elasticsearch 采集",
			ResourceCategory: CategoryMiddleware, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "Elasticsearch 中间件实例",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "middleware_type", Operator: RuleOpEq, Values: []string{"elasticsearch"}}}},
			SortOrder:       70, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateNginx, Name: "Nginx 采集",
			ResourceCategory: CategoryMiddleware, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "Nginx 中间件实例",
			DefaultSelector: Selector{Logic: RuleLogicAll, Filters: []ScopeFilter{{Field: "middleware_type", Operator: RuleOpEq, Values: []string{"nginx"}}}},
			SortOrder:       80, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateApplicationHTTP, Name: "应用服务（HTTP）采集",
			ResourceCategory: CategoryApplication, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "应用服务类资源，采集健康检查端点指标",
			DefaultSelector: all,
			SortOrder:       90, Enabled: true, IsBuiltin: true,
		},
		{
			Code: TemplateSNMP, Name: "网络设备（SNMP）采集",
			ResourceCategory: CategoryGenericTarget, MetricsPath: DefaultMetricsPath,
			Scheme: SchemeHTTP, ScrapeInterval: DefaultScrapeInterval, ScrapeTimeout: DefaultScrapeTimeout,
			Description:     "其他监控对象中的网络设备 / 自定义端点",
			DefaultSelector: all,
			SortOrder:       100, Enabled: true, IsBuiltin: true,
		},
	}
}

// BuiltinCollectionTemplate returns one built-in template by code.
func BuiltinCollectionTemplate(code string) (CollectionTemplate, bool) {
	for _, tpl := range BuiltinCollectionTemplates() {
		if tpl.Code == code {
			return tpl, true
		}
	}
	return CollectionTemplate{}, false
}
