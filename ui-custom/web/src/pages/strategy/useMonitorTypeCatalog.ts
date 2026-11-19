/**
 * 监控对象类型目录（SRS Module_01 v1.3 §5.6）。
 *
 * 后端 `monitor_type` 已配置化，前端不能再从写死常量取下拉选项——否则新建的类型
 * 在「采集器管理 / 采集 Job / 指标库 / 规则」中永远选不到。
 *
 * 本 hook 从 `/api/v3/platform/monitor-types` 拉取注册表：
 * - 首次订阅时加载一次，成功后全局缓存（页面间共享，不重复请求）；
 * - 失败或未加载完成时回退到 `strategyConstants` 的内置常量，保证静态预览与单测可用；
 * - 只把 `enabled` 的类型放进可选列表；停用类型仍保留名称用于历史数据展示；
 * - 筛选下拉可在展开时调用 `refreshMonitorTypeCatalog()` 重新拉取，保证选项与注册表同步。
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { monitorTypeApi } from '../../api/monitorTypes'
import type { ResourceCategory } from '../../types/resource'
import { MONITOR_TYPE_CASCADE, MONITOR_TYPE_MAP } from './strategyConstants'

export interface MonitorTypeOption {
  code: string
  name: string
  resource_category: ResourceCategory
  enabled: boolean
  is_builtin: boolean
  sort_order: number
}

export interface MonitorTypeCatalog {
  /** 是否已成功从后端加载（false 表示当前是内置回退数据） */
  loaded: boolean
  error: string | null
  /** 全量类型（含停用，用于历史数据展示名解析） */
  types: MonitorTypeOption[]
  /** 资源类别 → 可选类型（仅启用，按 sort_order 排序） */
  cascade: { category: ResourceCategory; types: string[] }[]
  /** code → 展示名 */
  names: Record<string, string>
  /** code → 资源类别 */
  categoryOf: Record<string, ResourceCategory>
  /** 某资源类别下可选的类型 code 列表 */
  optionsForCategory: (category?: ResourceCategory) => string[]
  /** 全部可选类型 code 列表 */
  allCodes: () => string[]
  /** 展示名（未知 code 原样返回） */
  nameOf: (code?: string | null) => string
  /** 由类型 code 反查资源类别 */
  categoryFor: (code?: string | null) => ResourceCategory | undefined
}

function buildFallbackTypes(): MonitorTypeOption[] {
  const types: MonitorTypeOption[] = []
  for (const group of MONITOR_TYPE_CASCADE) {
    for (const code of group.types) {
      types.push({
        code,
        name: MONITOR_TYPE_MAP[code] ?? code,
        resource_category: group.category,
        enabled: true,
        is_builtin: true,
        sort_order: types.length,
      })
    }
  }
  return types
}

function buildCatalog(types: MonitorTypeOption[], loaded: boolean, error: string | null): MonitorTypeCatalog {
  const names: Record<string, string> = {}
  const categoryOf: Record<string, ResourceCategory> = {}
  for (const item of types) {
    names[item.code] = item.name
    categoryOf[item.code] = item.resource_category
  }
  const order = ['host', 'database', 'middleware', 'application', 'generic_target', 'interface_service'] as const
  const cascade = order
    .map((category) => ({
      category: category as ResourceCategory,
      types: types
        .filter((item) => item.resource_category === category && item.enabled)
        .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code))
        .map((item) => item.code),
    }))
    .filter((group) => group.types.length > 0)

  return {
    loaded,
    error,
    types,
    cascade,
    names,
    categoryOf,
    optionsForCategory: (category) =>
      category ? cascade.find((group) => group.category === category)?.types ?? [] : cascade.flatMap((g) => g.types),
    allCodes: () => cascade.flatMap((group) => group.types),
    nameOf: (code) => (code ? names[code] ?? code : '-'),
    categoryFor: (code) => (code ? categoryOf[code] : undefined),
  }
}

let snapshot: MonitorTypeCatalog = buildCatalog(buildFallbackTypes(), false, null)
let loadStarted = false
const listeners = new Set<() => void>()

function emit(next: MonitorTypeCatalog) {
  snapshot = next
  for (const listener of listeners) listener()
}

/** 注册表/管理页返回的类型条目（sort_order 可缺省，缺省时按数组顺序补齐） */
interface MonitorTypeListEntry {
  code: string
  name: string
  resource_category: ResourceCategory
  enabled: boolean
  is_builtin: boolean
  sort_order?: number
}

function toOptions(list: MonitorTypeListEntry[]): MonitorTypeOption[] {
  return list.map((item, index) => ({
    code: item.code,
    name: item.name,
    resource_category: item.resource_category,
    enabled: item.enabled,
    is_builtin: item.is_builtin,
    sort_order: item.sort_order ?? index,
  }))
}

/**
 * 拉取注册表并发布快照。
 *
 * `keepOnError` 用于「主动刷新」：请求失败时保留当前可用目录，
 * 避免一次网络抖动把已经加载好的下拉降级成内置回退。
 */
function loadCatalog(keepOnError = false) {
  monitorTypeApi
    .list()
    .then((res) => {
      const list = res.data?.list ?? []
      if (list.length === 0) {
        // 全新库在 seed 之前可能为空：保留内置回退，避免下拉突然清空
        emit(buildCatalog(buildFallbackTypes(), false, null))
        return
      }
      emit(buildCatalog(toOptions(list), true, null))
    })
    .catch((err: Error) => {
      if (keepOnError && snapshot.loaded) return
      emit(buildCatalog(buildFallbackTypes(), false, err.message))
    })
}

/** 确保注册表已加载（幂等：并发订阅只发一次请求）。 */
export function ensureMonitorTypeCatalog() {
  if (loadStarted) return
  loadStarted = true
  loadCatalog()
}

/**
 * 主动重新拉取注册表（不复位当前目录）。
 *
 * 用于筛选下拉「打开时刷新」：监控对象类型支持手动新增/停用，
 * 重新进入页面或从其他会话新增后，下拉选项需要立即跟随注册表。
 */
export function refreshMonitorTypeCatalog() {
  loadStarted = true
  loadCatalog(true)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  ensureMonitorTypeCatalog()
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): MonitorTypeCatalog {
  return snapshot
}

/**
 * 订阅监控对象类型目录。组件在目录加载完成后自动重渲染，
 * 因此「新增类型 → 回到采集器管理/采集 Job」即可看到新选项。
 */
export function useMonitorTypeCatalog(): MonitorTypeCatalog {
  useEffect(() => {
    ensureMonitorTypeCatalog()
  }, [])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 非组件环境（纯函数）读取当前快照；仅在目录已加载时有意义。 */
export function currentMonitorTypeCatalog(): MonitorTypeCatalog {
  return snapshot
}

/** 测试 / 预览重置用。 */
export function resetMonitorTypeCatalogForTest() {
  loadStarted = false
  emit(buildCatalog(buildFallbackTypes(), false, null))
}

/**
 * 用页面已拿到的权威列表直接覆盖目录缓存。
 *
 * 「监控对象类型」页增删改后调用：避免目录仍是启动时的旧快照，
 * 导致用户切到采集 Job / 采集器管理时看不到刚建的类型。
 */
export function applyMonitorTypeList(list: MonitorTypeListEntry[]) {
  if (list.length === 0) {
    emit(buildCatalog(buildFallbackTypes(), false, null))
    return
  }
  loadStarted = true
  emit(buildCatalog(toOptions(list), true, null))
}

/** 供页面在提交前刷新（例如刚在「监控对象类型」页新增了类型）。 */
export function reloadMonitorTypeCatalog() {
  loadStarted = false
  ensureMonitorTypeCatalog()
}

/** 便捷 hook：只要展示名解析。 */
export function useMonitorTypeName(): (code?: string | null) => string {
  const catalog = useMonitorTypeCatalog()
  return useCallback((code?: string | null) => catalog.nameOf(code), [catalog])
}
