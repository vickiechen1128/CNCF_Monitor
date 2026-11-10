/**
 * 资源展示元数据（Module_07 §5.1/§5.2；对齐原型 RESOURCE_TYPE_MAP / STATUS_COLOR）。
 *
 * resources 目录内**唯一**的类别、运行状态、数据来源、子类字段与行内主标识展示口径来源；
 * 各页面 / 抽屉 / 弹窗统一从这里导入，避免重复定义导致文案漂移。
 * 仅使用 `import type`，不在运行期引入页面模块（避免循环依赖）。
 */
import type { ResourceCategory } from '../../types/resource'
import type { SkinTokens } from '../../skins'
import type { ResourceListItem } from './useResources'

/** 六类资源类别（Module_07 §5.1 / 决策 D19；含接口服务） */
export const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'interface_service', 'generic_target']

/** 资源类别展示名（对齐原型 RESOURCE_TYPE_MAP） */
export const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
  middleware: '中间件',
  application: '应用服务',
  generic_target: '其他监控目标',
  interface_service: '接口服务',
}

/** 子类取值字段（决策 91 首页 L1 各类型卡的子类口径）：
 * host=os_type / database=database_type / middleware=middleware_type /
 * generic_target=exporter_type；application 用 service_name、interface_service 用 api_name
 * （二者均不设子类，仅供深链兜底）。
 */
export const SUBTYPE_FIELD: Record<ResourceCategory, keyof ResourceListItem> = {
  host: 'os_type',
  database: 'database_type',
  middleware: 'middleware_type',
  application: 'service_name',
  generic_target: 'exporter_type',
  interface_service: 'api_name',
}

/** 运行状态展示名（Module_07 §5.2 / 决策 32，UI 展示名「运行状态」） */
export const STATUS_MAP: Record<string, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
  orphan: '孤儿',
}

/** 运行状态色（对齐原型 STATUS_COLOR，走皮肤 token） */
export function statusColor(tokens: SkinTokens): Record<string, string> {
  return {
    online: tokens.colorSuccess,
    offline: tokens.colorError,
    maintenance: tokens.colorWarning,
    orphan: tokens.colorTextTertiary,
  }
}

/** 数据来源展示名（Module_07 §5.2；cmdb 为 v0.4+ 预留） */
export const SOURCE_TYPE_MAP: Record<string, string> = {
  manual: '手动录入',
  import: 'Excel 导入',
  cmdb: 'CMDB 同步',
}

/** 行内主标识展示字段：取当前行可读名称，兜底 resource_id */
export function resourceDisplayName(record: ResourceListItem): string {
  return (
    record.instance_name ||
    record.service_name ||
    record.target_name ||
    record.api_name ||
    record.resource_id ||
    '-'
  )
}
