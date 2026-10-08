import type { ResourceCategory } from '../../types/resource'

/**
 * F-17「列设置」列显隐配置（资源列表宽表收敛）。
 *
 * 背景：`tablePresets.ts` 规范「列数 ≤ 8，超出字段下沉详情 Drawer」，而资源列表五类 Tab
 * 实际列数为 host 14 / database 14 / middleware 14 / application 15 / generic_target 17（含操作列），
 * 全部远超规范。F-13 的列头分组已撤销（分组不减列、横向滚动后语义归零），
 * 本模块按规范本身的另一条出路——**列显隐**——收敛宽度。
 *
 * 三条实现口径：
 * 1. **列的稳定标识直接用列 `key`**（不新增 `meta` 字段）：已复核五类列 key 各自唯一
 *    （共享列 `status` / `source_type` / `service_code` / `platform_code` / `network_domain_id` /
 *    `monitor_state` / `cloud_code` / `biz_code` / `app_code` / `actions` 全唯一，
 *    类别专属列在各自分支内亦唯一），故可安全用作持久化标识与勾选项 value；
 * 2. **偏好为纯前端视图态**（F-17 风险约束）：按 `resource_category` 分区存localStorage，
 *    不上传后端、不改变数据与列语义；
 * 3. **异常一律静默兜底**：localStorage 不可用（隐私模式 / SSR）降级为仅内存态；
 *    读到脏数据（解析失败 / 含已不存在的 key / 空数组）回退默认列集，**均不抛错**。
 */

/** 分组小标题：主标识列与操作列归「固定列」，其余按 F-13 撤销前的语义分组承载
 *  「哪些列是业务归属」的认知问题（**下拉内分组，不占表头**）。 */
export type ResourceColumnGroup = '固定列' | '技术属性 / 位置' | '业务归属'

/** 分组渲染顺序 */
export const COLUMN_GROUP_ORDER: ResourceColumnGroup[] = ['固定列', '技术属性 / 位置', '业务归属']

export interface ResourceColumnMeta {
  /** 列 `key`（与 `buildColumns` 定义一致，同时是持久化标识与勾选项 value） */
  key: string
  /**
   * 「列设置」下拉的勾选项文案。
   *
   * 独立登记而非从列 `title` 提取：多数列 `title` 是带 `Tooltip` 角标的 ReactNode，
   * 取不到纯文本；此处为列设置下拉提供稳定可断言的短标签。
   */
  label: string
  group: ResourceColumnGroup
}

/**
 * 五类Tab 的全量列清单（**顺序与 `buildColumns` 的返回列序严格一致**）。
 *
 * 「技术属性 / 位置」与「业务归属」的划分沿用 F-13 撤销前的原口径：
 * 主标识 → 类型专属列 → 网域 → 运行状态 → 采集状态 → 录入方式 → 云为技术属性 / 位置，
 * 平台 → 应用名称 → [所属服务] → 业务名称 为业务归属。
 */
export const RESOURCE_COLUMN_META: Record<ResourceCategory, ResourceColumnMeta[]> = {
  host: [
    { key: 'name', label: '实例名', group: '固定列' },
    { key: 'instance_ip', label: 'IP 地址', group: '技术属性 / 位置' },
    { key: 'os_type', label: '操作系统', group: '技术属性 / 位置' },
    { key: 'env', label: '环境', group: '技术属性 / 位置' },
    { key: 'cluster', label: '集群', group: '技术属性 / 位置' },
    { key: 'network_domain_id', label: '网域', group: '技术属性 / 位置' },
    { key: 'status', label: '运行状态', group: '技术属性 / 位置' },
    { key: 'monitor_state', label: '采集状态', group: '技术属性 / 位置' },
    { key: 'source_type', label: '录入方式', group: '技术属性 / 位置' },
    { key: 'cloud_code', label: '云', group: '技术属性 / 位置' },
    { key: 'platform_code', label: '平台', group: '业务归属' },
    { key: 'app_code', label: '应用名称', group: '业务归属' },
    { key: 'biz_code', label: '业务名称', group: '业务归属' },
    { key: 'actions', label: '操作', group: '固定列' },
  ],
  database: [
    { key: 'instance_name', label: '实例名', group: '固定列' },
    { key: 'database_type', label: '数据库类型', group: '技术属性 / 位置' },
    { key: 'instance_ip', label: 'IP 地址', group: '技术属性 / 位置' },
    { key: 'port', label: '端口', group: '技术属性 / 位置' },
    { key: 'version', label: '版本', group: '技术属性 / 位置' },
    { key: 'network_domain_id', label: '网域', group: '技术属性 / 位置' },
    { key: 'status', label: '运行状态', group: '技术属性 / 位置' },
    { key: 'monitor_state', label: '采集状态', group: '技术属性 / 位置' },
    { key: 'source_type', label: '录入方式', group: '技术属性 / 位置' },
    { key: 'cloud_code', label: '云', group: '技术属性 / 位置' },
    { key: 'platform_code', label: '平台', group: '业务归属' },
    { key: 'app_code', label: '应用名称', group: '业务归属' },
    { key: 'biz_code', label: '业务名称', group: '业务归属' },
    { key: 'actions', label: '操作', group: '固定列' },
  ],
  middleware: [
    { key: 'instance_name', label: '实例名', group: '固定列' },
    { key: 'middleware_type', label: '中间件类型', group: '技术属性 / 位置' },
    { key: 'instance_ip', label: 'IP 地址', group: '技术属性 / 位置' },
    { key: 'port', label: '端口', group: '技术属性 / 位置' },
    { key: 'version', label: '版本', group: '技术属性 / 位置' },
    { key: 'network_domain_id', label: '网域', group: '技术属性 / 位置' },
    { key: 'status', label: '运行状态', group: '技术属性 / 位置' },
    { key: 'monitor_state', label: '采集状态', group: '技术属性 / 位置' },
    { key: 'source_type', label: '录入方式', group: '技术属性 / 位置' },
    { key: 'cloud_code', label: '云', group: '技术属性 / 位置' },
    { key: 'platform_code', label: '平台', group: '业务归属' },
    { key: 'app_code', label: '应用名称', group: '业务归属' },
    { key: 'biz_code', label: '业务名称', group: '业务归属' },
    { key: 'actions', label: '操作', group: '固定列' },
  ],
  application: [
    { key: 'service_name', label: '服务名', group: '固定列' },
    { key: 'health_check_url', label: '健康检查 URL', group: '技术属性 / 位置' },
    { key: 'protocol', label: '协议', group: '技术属性 / 位置' },
    { key: 'endpoint', label: '端点', group: '技术属性 / 位置' },
    { key: 'port', label: '端口', group: '技术属性 / 位置' },
    { key: 'network_domain_id', label: '网域', group: '技术属性 / 位置' },
    { key: 'status', label: '运行状态', group: '技术属性 / 位置' },
    { key: 'monitor_state', label: '采集状态', group: '技术属性 / 位置' },
    { key: 'source_type', label: '录入方式', group: '技术属性 / 位置' },
    { key: 'cloud_code', label: '云', group: '技术属性 / 位置' },
    { key: 'platform_code', label: '平台', group: '业务归属' },
    { key: 'app_code', label: '应用名称', group: '业务归属' },
    { key: 'service_code', label: '所属服务', group: '业务归属' },
    { key: 'biz_code', label: '业务名称', group: '业务归属' },
    { key: 'actions', label: '操作', group: '固定列' },
  ],
  generic_target: [
    { key: 'target_name', label: '目标名称', group: '固定列' },
    { key: 'exporter_type', label: 'Exporter 类型', group: '技术属性 / 位置' },
    { key: 'instance_ip', label: 'IP 地址', group: '技术属性 / 位置' },
    { key: 'port', label: '端口', group: '技术属性 / 位置' },
    { key: 'metrics_path', label: '采集路径', group: '技术属性 / 位置' },
    { key: 'scheme', label: '协议', group: '技术属性 / 位置' },
    { key: 'custom_labels', label: '自定义标签', group: '技术属性 / 位置' },
    { key: 'network_domain_id', label: '网域', group: '技术属性 / 位置' },
    { key: 'status', label: '运行状态', group: '技术属性 / 位置' },
    { key: 'monitor_state', label: '采集状态', group: '技术属性 / 位置' },
    { key: 'source_type', label: '录入方式', group: '技术属性 / 位置' },
    { key: 'cloud_code', label: '云', group: '技术属性 / 位置' },
    { key: 'platform_code', label: '平台', group: '业务归属' },
    { key: 'app_code', label: '应用名称', group: '业务归属' },
    { key: 'service_code', label: '所属服务', group: '业务归属' },
    { key: 'biz_code', label: '业务名称', group: '业务归属' },
    { key: 'actions', label: '操作', group: '固定列' },
  ],
}

/**
 * 不可关闭的列（`fixed:'left'` 主标识 + `fixed:'right'` 操作）。
 *
 * 双重保障：既在勾选项上 `disabled`，渲染前再与可见集合取并集——
 * 即便localStorage 里存了缺这两列的脏数据，也不会把固定列挤出表头。
 */
export const FIXED_COLUMN_KEYS: Record<ResourceCategory, string[]> = {
  host: ['name', 'actions'],
  database: ['instance_name', 'actions'],
  middleware: ['instance_name', 'actions'],
  application: ['service_name', 'actions'],
  generic_target: ['target_name', 'actions'],
}

/**
 * PM 裁定的默认列集（F-17，不可自行更改）：P0 高频列，五类均≤ 7 列，
 * 满足 `tablePresets.ts`「列数 ≤ 8」。
 *
 * - host：实例名（主标识）+ 操作系统 + 网域 + 运行状态 + 采集状态 + 操作；
 * - database / middleware：数据库无 `os_type` 列（模型无该字段），
 *   「操作系统」位由各自的**类型专属列**（数据库类型 / 中间件类型）承担，
 *   否则该Tab 默认列集只剩 5 列且丢失「这是个什么库」的首要判别信息；
 * - application / generic_target：主标识（服务名 / 目标名称）+ 网域 + 运行状态
 *   + 采集状态 + 所属服务 + 操作。
 */
export const DEFAULT_VISIBLE_COLUMN_KEYS: Record<ResourceCategory, string[]> = {
  host: ['name', 'os_type', 'network_domain_id', 'status', 'monitor_state', 'actions'],
  database: ['instance_name', 'database_type', 'network_domain_id', 'status', 'monitor_state', 'actions'],
  middleware: ['instance_name', 'middleware_type', 'network_domain_id', 'status', 'monitor_state', 'actions'],
  application: ['service_name', 'network_domain_id', 'status', 'monitor_state', 'service_code', 'actions'],
  generic_target: ['target_name', 'network_domain_id', 'status', 'monitor_state', 'service_code', 'actions'],
}

/** 偏好存储键前缀：按 `resource_category` 分区，切换 Tab 各自恢复 */
const COLUMN_PREF_KEY_PREFIX = 'mc_res_list_cols_'

/** 某类Tab 的偏好存储键（如 `mc_res_list_cols_host`） */
export function columnPrefStorageKey(category: ResourceCategory): string {
  return `${COLUMN_PREF_KEY_PREFIX}${category}`
}

/**
 * 按列清单顺序归一化可见 key 集合。
 *
 * 顺带过滤已不存在的 key（列被下线 / 改名后的历史脏数据），并强制并入不可关闭的固定列。
 * 传入顺序不固定（`Checkbox.Group` 的 onChange 顺序不保证），归一化后落库顺序稳定可比对。
 */
export function orderColumnKeys(category: ResourceCategory, keys: readonly string[]): string[] {
  const known = new Set(RESOURCE_COLUMN_META[category].map((m) => m.key))
  const picked = new Set<string>([...FIXED_COLUMN_KEYS[category], ...keys.filter((k) => known.has(k))])
  return RESOURCE_COLUMN_META[category].map((m) => m.key).filter((k) => picked.has(k))
}

/**
 * 读取某类 Tab 的可见列key。
 *
 * 三种情况均**静默返回默认列集**，绝不抛错：
 * - localStorage 不可用（隐私模式 / SSR，`window` 或 `localStorage` 访问即抛）；
 * - 取不到值（首次访问）；
 * - 脏数据：`JSON.parse` 失败 / 非数组 / 含非字符串 / 含已不存在的 key / 空数组。
 */
export function loadVisibleColumnKeys(category: ResourceCategory): string[] {
  const fallback = orderColumnKeys(category, DEFAULT_VISIBLE_COLUMN_KEYS[category])
  let raw: string | null
  try {
    raw = window.localStorage.getItem(columnPrefStorageKey(category))
  } catch {
    // 隐私模式 / SSR：降级为默认列集，本次会话仅内存态
    return fallback
  }
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return fallback
    if (!parsed.every((k) => typeof k === 'string')) return fallback
    const known = new Set(RESOURCE_COLUMN_META[category].map((m) => m.key))
    // 含已不存在的 key → 整体回退默认列集（不做部分保留，避免半残偏好更难解释）
    if (parsed.some((k) => !known.has(k))) return fallback
    if (parsed.length === 0) return fallback
    return orderColumnKeys(category, parsed as string[])
  } catch {
    return fallback
  }
}

/** 落库某类 Tab 的可见列 key；localStorage 不可用时静默忽略（退化为仅内存态） */
export function saveVisibleColumnKeys(category: ResourceCategory, keys: readonly string[]): void {
  try {
    window.localStorage.setItem(columnPrefStorageKey(category), JSON.stringify(orderColumnKeys(category, keys)))
  } catch {
    // 隐私模式 / 配额超限：仅内存态，不报错
  }
}

/**
 * F-17 附加：恢复某类 Tab 的默认列集。
 *
 * 背景：用户把列取消到极简后，若没有本入口，只能手动逐个勾回 P0 高频列
 * （host 需勾 5 次、generic_target 需勾 5 次），属可避免的重复操作。
 *
 * 语义选择——**写入默认列集**而非 `removeItem` 清空偏好：两者对 `loadVisibleColumnKeys`
 * 的结果等价（无值时同样回退默认集），但写入后存储态与内存态始终一致，
 * 便于排查「用户是否重置过」；且复用 `orderColumnKeys` 归一化，
 * 默认集若含已被下线的列也能被正确过滤。
 */
export function resetVisibleColumnKeys(category: ResourceCategory): string[] {
  const defaults = orderColumnKeys(category, DEFAULT_VISIBLE_COLUMN_KEYS[category])
  saveVisibleColumnKeys(category, defaults)
  return defaults
}

/** 某类Tab 当前是否已是默认列集（供「恢复默认」入口的禁用态判断） */
export function isDefaultVisibleColumnKeys(category: ResourceCategory, keys: readonly string[]): boolean {
  const a = orderColumnKeys(category, keys)
  const b = orderColumnKeys(category, DEFAULT_VISIBLE_COLUMN_KEYS[category])
  return a.length === b.length && a.every((k, i) => k === b[i])
}