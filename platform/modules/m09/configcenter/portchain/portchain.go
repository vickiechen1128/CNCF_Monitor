// Package portchain 提供采集端口四级优先级解析的纯函数实现（决策 D-2=B）。
//
// 权威定义见 docs/05-execution-records/module-01/design-proposals/
// resource-scrape-port-chain.md §5.1：
//
//	Resource.scrape_port（实例级，0/NULL = 未指定）
//	  → CITypeExporterMapping.default_port（类型默认，is_default=true 行）
//	    → ExporterTemplate.default_port（采集器默认）
//	      → 业务 port（最后兜底，仅 database/middleware；host 到模板层为止）
//
// 本包为叶子包：只做「按序取第一个有效端口并标注来源」，不 import
// strategy/*、generator 等任何上层包，供 generator 与 strategy/scrapejob
// 共用以避免 D2 类口径漂移。
package portchain

// 端口来源枚举（source 返回值），供 M01 采集 Job 抽屉「生效端口」回显消费：
const (
	// SourceInstance：实例级覆盖（Resource.scrape_port）。
	SourceInstance = "instance"
	// SourceMapping：类型映射默认（CITypeExporterMapping.default_port）。
	SourceMapping = "mapping"
	// SourceTemplate：采集器模板默认（ExporterTemplate.default_port）。
	SourceTemplate = "template"
	// SourceBusiness：业务端口兜底（仅 db/mw，展示时附警示 ⚠️）。
	SourceBusiness = "business"
	// SourceUnresolved：四级全缺（0/NULL），地址不展示端口。
	SourceUnresolved = "unresolved"
)

// Resolve 按四级优先级解析生效端口，返回 (端口, 来源)。
//
// 参数依次为 scrapePort（实例级）、mappingPort（类型映射层）、
// templatePort（采集器模板层）、businessPort（业务端口兜底）；0 与 NULL
// 等价视为「未指定」向下回落，全 0 时返回 (0, SourceUnresolved)。
//
// 调用方形态：
//   - generator 侧 LoadExporterPort 返回值已合并 mapping/template 两层
//     （命中映射返回映射端口、否则回落模板端口），故传
//     Resolve(scrapePort, exporterPort, 0, businessPort)——templatePort
//     恒 0，数值语义与 M→T 段等价（generator 只消费 port 不消费 source）；
//   - strategy/scrapejob 侧（T01-P4）可分别加载两层以精确区分来源；
//   - host 无业务端口概念，businessPort 恒传 0，天然不产生 business 来源。
func Resolve(scrapePort, mappingPort, templatePort, businessPort int) (port int, source string) {
	switch {
	case scrapePort > 0:
		return scrapePort, SourceInstance
	case mappingPort > 0:
		return mappingPort, SourceMapping
	case templatePort > 0:
		return templatePort, SourceTemplate
	case businessPort > 0:
		return businessPort, SourceBusiness
	default:
		return 0, SourceUnresolved
	}
}
