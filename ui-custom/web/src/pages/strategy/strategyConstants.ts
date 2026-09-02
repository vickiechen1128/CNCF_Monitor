/**
 * 采集策略页面共享常量（Module_01 §9/§11.1）。
 *
 * monitor_type 两级级联：资源类别（host/database/middleware/application/generic_target）
 * → 细粒度监控对象类型（MONITOR_TYPE_DERIVATION_MAP 推导）。
 */
import type { ResourceCategory } from '../../types/resource'
import type { MonitorType, RuleContentMode, ScopeType } from '../../types/strategy'
import type { JobInstanceScrapeStatus } from './useScrapeJobStatus'

/** monitor_type 细粒度展示名（§11.1 监控对象类型） */
export const MONITOR_TYPE_MAP: Record<MonitorType, string> = {
  host_linux: 'Linux 主机',
  host_windows: 'Windows 主机',
  mysql: 'MySQL',
  redis: 'Redis',
  kafka: 'Kafka',
  elasticsearch: 'Elasticsearch',
  nginx: 'Nginx',
  application_http: 'HTTP 应用',
  snmp: 'SNMP 目标',
}

/** 资源类别展示名（对齐 M07 RESOURCE_TYPE_MAP） */
export const CATEGORY_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/** 资源类别 → 细粒度 monitor_type 级联（§9 MONITOR_TYPE_DERIVATION_MAP） */
export const MONITOR_TYPE_CASCADE: { category: ResourceCategory; types: MonitorType[] }[] = [
  { category: 'host', types: ['host_linux', 'host_windows'] },
  { category: 'database', types: ['mysql', 'redis'] },
  { category: 'middleware', types: ['kafka', 'elasticsearch', 'nginx'] },
  { category: 'application', types: ['application_http'] },
  { category: 'generic_target', types: ['snmp'] },
]

/** 采集参数列可覆盖字段（§5.4 参数同步） */
export const SCRAPE_PARAM_FIELDS = [
  { field: 'scrape_interval', label: '采集间隔' },
  { field: 'scrape_timeout', label: '采集超时' },
  { field: 'metrics_path', label: '采集路径' },
  { field: 'scheme', label: '协议' },
] as const

/** job_type 展示名（§11.1 采集 / 拨测） */
export const JOB_TYPE_MAP: Record<string, string> = {
  standard: '采集',
  blackbox: '拨测',
}

/** 下发状态（change_status，§9）展示名 */
export const CHANGE_STATUS_MAP: Record<string, string> = {
  none: '无',
  pending: '待下发',
  confirmed: '已确认',
  deployed: '已生效',
}

/** 草稿状态（draft_status，§9）展示名 */
export const DRAFT_STATUS_MAP: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
}

/** 规则内容形态（content_mode，§9）展示名 */
export const CONTENT_MODE_MAP: Record<RuleContentMode, string> = {
  yaml_passthrough: '文件透传',
  structured: '字段化',
}

/** 求值范围（scope，§9）展示名 */
export const SCOPE_MAP: Record<ScopeType, string> = {
  central: '集中',
  edge: '边缘',
  both: '集中 + 边缘',
}

/** 指标类型（metric_type，§9）展示名 */
export const METRIC_TYPE_MAP: Record<string, string> = {
  counter: '计数',
  gauge: '仪表',
  histogram: '直方图',
  summary: '摘要',
  unknown: '未知',
}

/** 认证类型（auth_type，§9）展示名 */
export const AUTH_TYPE_MAP: Record<string, string> = {
  none: '无',
  basic: '用户名密码',
  bearer: 'Bearer Token',
}

/** 实例「采集状态」展示（决策 47-2：采集正常 / 已下发未采到 / 待采集） */
export const SCRAPE_STATUS_META: Record<JobInstanceScrapeStatus, { label: string; badge: 'success' | 'error' | 'default' }> = {
  // 与 M07 MonitorStatusBadge 的「采集中」统一口径（LOW-3），同指绿色采集正常态
  collecting: { label: '采集中', badge: 'success' },
  down: { label: '已下发未采到', badge: 'error' },
  pending: { label: '待采集', badge: 'default' },
}

/** 已下发未采到（down）的行内引导文案（决策 47-2） */
export const DOWN_TOOLTIP = '配置已下发但未采集到数据，请检查采集器安装与网络连通'