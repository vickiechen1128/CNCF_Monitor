/**
 * 标签模板页共享常量（T07-F8）。
 *
 * 与 Module_07 §5.11/§5.12/§6.5、后端 models/label_rules.go 及原型
 * docs/prototypes/module-07/src/mocks/module-07.ts 对齐：
 * - 保护 label 清单以后端 `PROTECTED_PROMETHEUS_LABELS`（7 项）为权威；
 * - 来源类型 / 转换规则选项、各资源类别字段来源选项供右栏三 Tab 与映射抽屉共用，
 *   避免两处散点硬编码。
 */
import type { LabelSourceType } from '../../types/label'
import type { ResourceCategory } from '../../types/resource'

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
export const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/**
 * 允许实例级自定义的资源类别（PRD §3.3/§5.2/§6.2 双场景治理边界）：
 * 仅业务类型资源（application）开放 user 来源实例级标签；host / database / middleware /
 * generic_target 实例级标签只读（治理在 CMDB 侧），无实例级自定义能力。
 * 驱动「关联实例」Tab 与左栏关联实例 badge 的展示——仅本集合内类别展示
 * （未来微服务 / 业务属性类型开放实例级能力时加入本集合即可）。
 */
export const INSTANCE_LEVEL_CUSTOM_CATEGORIES: ResourceCategory[] = ['application']

/** 实例状态展示名（对齐原型 STATUS_MAP；孤儿为后续版本预留） */
export const INSTANCE_STATUS_MAP: Record<string, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
}

/** 关联实例状态筛选选项 */
export const INSTANCE_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'maintenance', label: '维护中' },
]

/** 映射来源类型展示名（对齐原型 SOURCE_TYPE_LABEL） */
export const SOURCE_TYPE_LABEL: Record<LabelSourceType, string> = {
  resource_field: '资源字段',
  prometheus_builtin: 'Prometheus 内置字段',
  composite: '组合字段',
  cmdb_field: 'CMDB 字段',
}

/** 映射来源类型 Tag 颜色（对齐原型 SOURCE_TYPE_COLOR） */
export const SOURCE_TYPE_COLOR: Record<LabelSourceType, string> = {
  resource_field: 'blue',
  prometheus_builtin: 'purple',
  composite: 'cyan',
  cmdb_field: 'default',
}

/**
 * 映射抽屉「来源类型」可选项（§5.12 B / §5.11）：
 * MVP 新增映射仅开放「资源字段」；prometheus_builtin 由 Prometheus 原生注入、组合字段
 * 为默认模板内置，新增时隐藏；cmdb_field v0.4+ 预留、disabled 呈现。
 * （编辑存量 composite / prometheus_builtin 映射时，由组件在运行期补入当前值并置灰。）
 */
export const MAPPING_SOURCE_TYPE_OPTIONS: { value: LabelSourceType; label: string; disabled?: boolean }[] = [
  { value: 'resource_field', label: '资源字段' },
  { value: 'cmdb_field', label: 'CMDB 字段（后续版本开放）', disabled: true },
]

/** 转换规则选项（§5.11：空=原样透传 / lower / upper；prefix / replace 需参数，P1 置灰） */
export const TRANSFORM_OPTIONS: { value: string; label: string; disabled?: boolean }[] = [
  { value: '', label: '无（原样透传）' },
  { value: 'lower', label: 'lower（转小写）' },
  { value: 'upper', label: 'upper（转大写）' },
  { value: 'prefix', label: 'prefix（加前缀，后续开放）', disabled: true },
  { value: 'replace', label: 'replace（正则替换，后续开放）', disabled: true },
]

/** 保护 label 清单（§5.3/§5.11：禁止作为目标标签；composite→instance 例外），与后端一致 */
export const PROTECTED_PROMETHEUS_LABELS = [
  'instance',
  'job',
  'scheme',
  '__address__',
  '__scheme__',
  '__metrics_path__',
  '__name__',
]

/** 各资源类别 Resource 字段来源选项（§5.12 A，对齐原型 RESOURCE_FIELD_OPTIONS） */
export const RESOURCE_FIELD_OPTIONS: Record<ResourceCategory, string[]> = {
  host: ['instance_name', 'hostname', 'instance_ip', 'os_type', 'os_version', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  database: ['instance_name', 'database_type', 'instance_ip', 'port', 'version', 'connection_string', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  middleware: ['instance_name', 'middleware_type', 'instance_ip', 'port', 'version', 'connection_string', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  application: ['instance_name', 'service_name', 'biz_code', 'health_check_url', 'protocol', 'endpoint', 'port', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  generic_target: ['instance_name', 'target_name', 'instance_ip', 'port', 'metrics_path', 'scheme', 'exporter_type', 'custom_labels', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
}

/** 组合字段选项（§5.12 C：MVP 仅 instance_ip:port → instance） */
export const COMPOSITE_OPTIONS = ['instance_ip:port']

/** v0.4+ CMDB 字段选项（§5.12 A，预留） */
export const CMDB_FIELD_OPTIONS = ['cmdb_ci_id', 'cmdb_business_path', 'cmdb_module_path', 'cmdb_maintainer']

/** Prometheus 内置字段（§5.12 B，不含 __name__；MVP 隐藏） */
export const PROMETHEUS_BUILTIN_OPTIONS = ['__address__', '__scheme__', '__metrics_path__', 'job', 'instance']
