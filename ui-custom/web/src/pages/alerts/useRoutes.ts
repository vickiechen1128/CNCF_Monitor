/**
 * 「路由规则」页数据 Hook。
 *
 * 只读数据来源：`GET /api/v2/platform/alertmanager/routes`（仅全局认证）：
 *   成功 → `{ items, dead_receivers, effective_checksum, pending }`；
 *   解析失败 → `{ parse_error, raw_yaml }`（非 500、不白屏）。
 *
 * 编辑态（`useRouteEditor`）：
 * - 进入编辑 = 只读树 → 编辑态树（`fromRouteNodes`，`enabled` 显式置 true）；
 * - 顺序用上移 / 下移 / 拖拽表达，落盘顺序 = 同层数组位置；
 * - 保存 = **只提交结构化路由树 + base_checksum** 给
 *   `POST /api/v2/platform/alertmanager/routes`，由后端生成 route 段、合并整份配置、
 *   amtool 校验并触发 M09 变更单。前端不再生成 / 合并 YAML。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { alertmanagerRoutesApi, notifyChannelsApi } from '../../api/alertmanager'
import type { RouteNode, RouteTreeData } from '../../types/alertmanager'
import {
  DEFAULT_RECEIVER_NAME,
  emptyRouteTree,
  flattenRouteTree,
  fromRouteNodes,
  moveSibling,
  removeSubtree,
  reorderSibling,
  upsertNode,
  validateRouteReceivers,
  validateRouteTree,
  type RouteEditNode,
  type RouteIssue,
} from './routeTree'

/** 树形展开后的一行：节点 + 缩进深度（根为 0） */
export interface RouteRow {
  node: RouteNode
  depth: number
}

/** 树节点最小结构（供通用前序展开复用） */
interface RouteTreeItem {
  id: string
  parent_id: string
  order: number
}

/** 通用前序展开：按 `parent_id` 建树、**按数组顺序**取同级（根恒置顶） */
export function buildTreeRows<T extends RouteTreeItem>(items: T[]): { node: T; depth: number }[] {
  const byParent = new Map<string, T[]>()
  for (const node of items ?? []) {
    const siblings = byParent.get(node.parent_id)
    if (siblings) siblings.push(node)
    else byParent.set(node.parent_id, [node])
  }
  const rows: { node: T; depth: number }[] = []
  const walk = (nodes: T[], depth: number) => {
    for (const node of nodes) {
      rows.push({ node, depth })
      walk(byParent.get(node.id) ?? [], depth + 1)
    }
  }
  // 根节点的 parent_id 为空串（契约），从此处起遍历即得「根置顶」的层级序
  walk(byParent.get('') ?? [], 0)
  return rows
}

export interface UseRoutesResult {
  data: RouteTreeData | null
  /** 按 `parent_id` / `order` 建树后前序展开的行（根恒置顶）；解析失败时为空 */
  rows: RouteRow[]
  loading: boolean
  error: string | null
  /** 加载是否已到终态（成功或降级皆为 true）；供「编辑路由」刷新后触发载入 */
  ready: boolean
  /** 当前合并基 sha256；进入编辑时作为 base_checksum 回传，保存时做乐观锁 */
  effectiveChecksum: string
  /** 管理域当前活 pending 变更单；存在即表示页面展示的是待确认版本 */
  pending: RouteTreeData['pending']
  /**
   * 重新拉取只读视图。可选 `after` 在本次加载结束后回调（ok=是否成功，data=本次最新数据）。
   * 页面用它在「编辑路由」刷新完成后载入编辑区，避免把 setState 放进 effect；
   * 回传 data 是为了避免回调里拿到旧闭包中的 sourceItems。
   */
  reload: (after?: (ok: boolean, data: RouteTreeData | null) => void) => void
}

/**
 * 按 `parent_id` / `order` 把扁平节点序列还原为树并前序展开（根置顶）。
 *
 * 后端 `items` 本身已是前序序列（`items[0]` = 根），此处**按结构重建**而非依赖返回顺序，
 * 保证列表缩进层级与同级优先级（`order` 升序）与 AM 原生语义一致。
 */
export function buildRouteRows(items: RouteNode[]): RouteRow[] {
  const sorted = [...(items ?? [])].sort((a, b) => a.order - b.order)
  return buildTreeRows(sorted)
}

/** 编辑态树前序展开：顺序直接取**数组位置**（`order` 仅为编辑态辅助，不参与排序） */
export function buildEditRows(items: RouteEditNode[]): { node: RouteEditNode; depth: number }[] {
  return buildTreeRows(flattenRouteTree(items ?? []))
}

export function useRoutes(): UseRoutesResult {
  const [data, setData] = useState<RouteTreeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const afterLoadRef = useRef<((ok: boolean, data: RouteTreeData | null) => void)[]>([])

  const reload = useCallback((after?: (ok: boolean, data: RouteTreeData | null) => void) => {
    if (typeof after === 'function') afterLoadRef.current.push(after)
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      let ok = true
      let fresh: RouteTreeData | null = null
      try {
        const res = await alertmanagerRoutesApi.getRoutes()
        if (cancelled) return
        fresh = res.data ?? null
        setData(fresh)
        setError(null)
      } catch (e) {
        if (cancelled) return
        ok = false
        fresh = null
        setData(null)
        setError(e instanceof Error ? e.message : '加载路由规则失败，请稍后重试')
      } finally {
        if (!cancelled) {
          setLoading(false)
          const callbacks = afterLoadRef.current
          afterLoadRef.current = []
          for (const cb of callbacks) cb(ok, fresh)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const rows = useMemo(() => (data?.items ? buildRouteRows(data.items) : []), [data])
  // 失败也算终态：否则网络错误时页面会永远停在「未就绪」。
  return {
    data,
    rows,
    loading,
    error,
    ready: !loading,
    effectiveChecksum: data?.effective_checksum ?? '',
    pending: data?.pending ?? null,
    reload,
  }
}

// =====================================================================
// 编辑态（T08-F11）
// =====================================================================

/**
 * 导入结果状态：
 * - `empty`：尚未进入编辑态（页面初始态 / 放弃编辑后）；
 * - `imported`：已把当前配置载入编辑区（后端解析成功，字段无损）；
 * - `partial`：当前配置无法完整解析，已给空白起点供手动校正。
 */
export type RouteImportState = 'empty' | 'imported' | 'partial'

export interface UseRouteEditorOptions {
  /** 只读视图解析出的路由节点（解析失败时缺省） */
  sourceItems?: RouteNode[]
  /** 只读视图解析失败原因（存在即按空白树开始，并提示手动补齐）。 */
  parseError?: string
  /**
   * 进入编辑时 GET /routes 返回的 effective_checksum；保存时回传后端做乐观锁。
   * 为空时后端跳过冲突检测（兼容旧调用方）。
   */
  baseChecksum?: string
  /** 解析失败时的 alertmanager.yml 原文（供手动校正时对照） */
  rawYAML?: string
  /** 保存成功后回调（页面用于刷新只读视图 / 提示） */
  onSaved?: () => void
  /**
   * 部分导入（importState === 'partial'）保存前的确认回调（H4 护栏）。
   * 返回 true 才真正保存；false 中止保存。不传则默认直接保存（页面层应注入基于 antd Modal 的实现）。
   */
  confirmPartialImport?: () => Promise<boolean>
}

export interface UseRouteEditorResult {
  /** 编辑态树（前序扁平；`[0]` 为根） */
  tree: RouteEditNode[]
  /** 前序展开行（含缩进深度） */
  rows: { node: RouteEditNode; depth: number }[]
  importState: RouteImportState
  /** 是否存在未保存改动（与进入编辑时的基线树比较） */
  dirty: boolean
  /** 导入提示（部分导入 / 完整导入），无提示时为 null */
  importNotice: string | null
  /** 解析失败时回传的原文，供「手动校正」对照 */
  rawYAML: string
  /** 校验结论（含阻断与警告） */
  issues: RouteIssue[]
  blocking: RouteIssue[]
  warnings: RouteIssue[]
  /** 已启用渠道派生的可用接收人名（取不到时为空 = 无法判定悬空） */
  knownReceivers: string[]
  /**
   * 平台物化 receiver 名 → 渠道中文名（如 `notify-1` → `运维告警飞书群`）。
   * 供列表页 / 编辑抽屉把晦涩的 `notify-N` 显示成用户认识的渠道名；
   * 不在映射内的 receiver（如手写的 `feishu`）按原样展示。
   */
  receiverChannelNames: Record<string, string>
  saving: boolean
  /** 保存结果提示（成功 / 失败），未保存为 null */
  saveResult: { ok: boolean; message: string } | null
  /**
   * 进入编辑态：把当前只读路由树载入编辑区。
   * 页面默认只读，仅由用户点击「编辑路由」时调用；不会修改服务端数据。
   */
  importFromCurrent: (items?: RouteNode[], parseErr?: string) => void
  move: (id: string, dir: -1 | 1) => void
  reorder: (fromId: string, toId: string) => void
  remove: (id: string) => void
  upsert: (node: RouteEditNode) => void
  /** 放弃编辑，回到未导入态 */
  reset: () => void
  /** 保存：预检 → 生成 route 段 → 合并整份 → 复用挂载端点 → M09 变更单。返回是否成功 */
  save: () => Promise<boolean>
}

/**
 * 编辑态 Hook：载入 / 顺序调整 / 删除 / 预检 / 保存。
 *
 * 保存链路：只提交 `{ base_checksum, route_tree }` 给
 * `POST /api/v2/platform/alertmanager/routes`；route YAML 生成、整份合并、amtool 校验、
 * 版本落库与 M09 变更单全部由后端完成。
 */
export function useRouteEditor(options: UseRouteEditorOptions = {}): UseRouteEditorResult {
  const {
    sourceItems,
    parseError,
    rawYAML = '',
    baseChecksum = '',
    onSaved,
    confirmPartialImport,
  } = options
  const [tree, setTree] = useState<RouteEditNode[]>([])
  /** 进入编辑时的基线树；用于判断「放弃编辑」是否需要二次确认 */
  const [baseline, setBaseline] = useState<RouteEditNode[]>([])
  const [importState, setImportState] = useState<RouteImportState>('empty')
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)

  // 可用接收人（knownReceivers）= 平台内置 default ∪ 已启用通知渠道物化名。
  //
  // 2026-10-22 口径收口：不再把「当前 YAML receivers: 段已声明名」并入合法集合。
  // 手写/导入整份 YAML 的能力已删除，历史残留的自定义 receiver 与已停用渠道的
  // receiver 都不应再被选中；路由仍引用它们时判 dangling 并阻断保存。
  const [platformReceivers, setPlatformReceivers] = useState<string[]>([])
  /** 平台物化 receiver 名 → 渠道中文名（供 UI 把 `notify-N` 显示成用户认识的渠道名） */
  const [receiverChannelMap, setReceiverChannelMap] = useState<Record<string, string>>({})

  // 批量、非 admin 的 `notifyChannelsApi.list()`：响应已含各渠道物化的 AM receiver 名
  // （`receiver_name`，与 M09 生成器同源、非敏感），一次请求即可拿到全部平台物化名，
  // 不逐渠道调用 admin-only 的 `getReceiverSnippet`（N+1、非管理员取不到 → 校验失效）。
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await notifyChannelsApi.list()
        const items = (res.data?.items ?? []).filter((c) => c.receiver_name)
        if (!cancelled) {
          setPlatformReceivers(items.map((c) => c.receiver_name as string))
          const map: Record<string, string> = {}
          for (const c of items) map[c.receiver_name as string] = c.name
          setReceiverChannelMap(map)
        }
      } catch {
        if (!cancelled) {
          setPlatformReceivers([])
          setReceiverChannelMap({})
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const knownReceivers = useMemo(() => {
    const out = new Set<string>()
    // 平台内置空接收人始终合法（即使当前配置/渠道里都还没声明它）。
    out.add(DEFAULT_RECEIVER_NAME)
    for (const n of platformReceivers) if (n) out.add(n)
    return Array.from(out)
  }, [platformReceivers])

  /**
   * 实际执行载入。
   * 可显式传入 items / parseErr：页面「编辑路由」刷新完成后用本次最新数据载入，
   * 避免回调闭包里拿到刷新前的旧 sourceItems。
   */
  const doImport = useCallback((items: RouteNode[] | undefined = sourceItems, parseErr: string | undefined = parseError) => {
    setSaveResult(null)
    const errText = (parseErr ?? '').trim()
    if (errText) {
      // 后端 T08-12 对不可表达结构 return error（无 raw 标注通道）→ 不可无损导入：
      // 给空白根路由起点 + 明示提示 + 原文可对照，允许用户手动校正补齐。
      const empty = emptyRouteTree()
      setTree(empty)
      setBaseline(empty)
      setImportState('partial')
      setImportNotice(
        `当前路由配置无法被平台完整解析，已为你创建空白路由树，请手动补齐：${errText}`,
      )
      return
    }
    if (!items || items.length === 0) {
      // 无既有配置属正常起步态：给空白根路由，但不按「解析失败 / 需校正」告警，
      // 也不触发保存前的覆盖式二次确认（没有旧 route 段可覆盖）。
      const empty = emptyRouteTree()
      setTree(empty)
      setBaseline(empty)
      setImportState('imported')
      setImportNotice('当前没有生效的路由配置，已为你创建空白路由树，直接新建规则即可。')
      return
    }
    const loaded = fromRouteNodes(items)
    setTree(loaded)
    setBaseline(loaded)
    setImportState('imported')
    // 「当前配置」是平台术语，用户看不懂它指什么（2026-10-13 反馈）：明说是「平台当前生效的
    // alertmanager.yml」、导到哪去、下一步点哪个按钮（保存按钮就在这条提示上方）。
    setImportNotice(
      `已载入平台当前生效的 alertmanager.yml 中的 ${items.length} 个路由（名称由注释还原），请核对下方列表，无误后点上方「保存并提交变更」提交。`,
    )
  }, [parseError, sourceItems])

  /**
   * 用户点击「编辑路由」：把当前只读树载入编辑区。
   * 页面默认只读，不再首屏自动进入编辑态；本操作不写服务端。
   */
  const importFromCurrent = useCallback(
    (items?: RouteNode[], parseErr?: string) => {
      doImport(items, parseErr)
    },
    [doImport],
  )

  const move = useCallback((id: string, dir: -1 | 1) => {
    setTree((prev) => moveSibling(prev, id, dir))
    setSaveResult(null)
  }, [])

  const reorder = useCallback((fromId: string, toId: string) => {
    setTree((prev) => reorderSibling(prev, fromId, toId))
    setSaveResult(null)
  }, [])

  const remove = useCallback((id: string) => {
    setTree((prev) => removeSubtree(prev, id))
    setSaveResult(null)
  }, [])

  const upsert = useCallback((node: RouteEditNode) => {
    setTree((prev) => upsertNode(prev, node))
    setSaveResult(null)
  }, [])

  const reset = useCallback(() => {
    setTree([])
    setBaseline([])
    setImportState('empty')
    setImportNotice(null)
    setSaveResult(null)
  }, [])

  const issues = useMemo(() => {
    if (tree.length === 0) return [] as RouteIssue[]
    return [...validateRouteTree(tree), ...validateRouteReceivers(tree, knownReceivers)]
  }, [tree, knownReceivers])

  const blocking = useMemo(() => issues.filter((i) => i.level === 'error'), [issues])
  const warnings = useMemo(() => issues.filter((i) => i.level === 'warning'), [issues])

  const rows = useMemo(() => buildEditRows(tree), [tree])

  /** 是否相对进入编辑时发生了改动（用于放弃编辑免打扰）。 */
  const dirty = useMemo(
    () => JSON.stringify(tree) !== JSON.stringify(baseline),
    [tree, baseline],
  )

  const save = useCallback(async (): Promise<boolean> => {
    setSaveResult(null)
    if (tree.length === 0) {
      setSaveResult({ ok: false, message: '请先新建路由规则，或点「载入当前配置」后再保存。' })
      return false
    }
    const errors = [...validateRouteTree(tree), ...validateRouteReceivers(tree, knownReceivers)].filter(
      (i) => i.level === 'error',
    )
    if (errors.length > 0) {
      setSaveResult({ ok: false, message: `保存前预检未通过（${errors.length} 项）：${errors[0].message}` })
      return false
    }
    // 当前配置无法完整解析时，保存会以编辑中的路由覆盖原 route 段，需二次确认。
    if (importState === 'partial') {
      const confirmed = confirmPartialImport ? await confirmPartialImport() : true
      if (!confirmed) {
        setSaveResult({
          ok: false,
          message: '已取消保存：当前配置无法完整解析，覆盖式保存会改写原有路由段，需二次确认后才能提交。',
        })
        return false
      }
    }
    setSaving(true)
    try {
      // 前端只提交结构化路由树 + base_checksum；route YAML 由后端生成。
      const res = await alertmanagerRoutesApi.saveRoutes({
        base_checksum: baseChecksum,
        route_tree: tree,
      })
      const changeNo = res.data?.change_no
      setSaveResult({
        ok: true,
        message: changeNo
          ? `已提交并生成变更单 ${changeNo}。改动不会自动生效——请前往「配置变更确认」人工确认，确认后才会写入并 reload Alertmanager。`
          : '已提交，等待你在「配置变更确认」中确认下发。改动不会自动生效。',
      })
      onSaved?.()
      return true
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败，请稍后重试'
      // 409 = 配置已被他人更新；后端文案已说明需要重新载入。
      setSaveResult({ ok: false, message: `保存失败：${message}` })
      return false
    } finally {
      setSaving(false)
    }
  }, [tree, knownReceivers, onSaved, importState, confirmPartialImport, baseChecksum])

  return {
    tree,
    rows,
    importState,
    dirty,
    importNotice,
    rawYAML,
    issues,
    blocking,
    warnings,
    knownReceivers,
    receiverChannelNames: receiverChannelMap,
    saving,
    saveResult,
    importFromCurrent,
    move,
    reorder,
    remove,
    upsert,
    reset,
    save,
  }
}
