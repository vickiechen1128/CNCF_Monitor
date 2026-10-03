/**
 * 「路由规则」页数据 Hook（T08-F10 只读路由树 + T08-F11 编辑态）。
 *
 * 只读数据来源：`GET /api/v2/platform/alertmanager/routes`（T08-12 后端契约；仅全局认证、只读无写能力）。
 * 成功 → `{ mode, items, dead_receivers }`；解析失败 → `{ mode, parse_error, raw_yaml }`（非 500、不白屏）。
 *
 * 编辑态（`useRouteEditor`，T08-F11）：
 * - 「从当前配置导入」= 只读树 → 编辑态树（`fromRouteNodes`，`enabled` 显式置 true）；
 *   解析失败（后端对不可表达结构 return error，无 raw 通道）→ **部分导入**降级：空白根路由起点 + 提示 + 原文可查，允许手动校正；
 * - 顺序用**上移 / 下移**表达（拖拽为增强），落盘顺序 = 同层数组位置；
 * - 保存 = 生成 route 段 → 合并进整份 alertmanager.yml → 复用既有
 *   `POST /api/v2/platform/alertmanager/config`（**零新增端点**）→ 触发 M09 变更单，不即时生效。
 *
 * 归属边界：不解析 YAML（前端零 yaml 依赖）；生成 / 合并的语义镜像后端 Go 侧（见 `routeTree.ts` 头注）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { alertmanagerConfigApi, alertmanagerRoutesApi, notifyChannelsApi } from '../../api/alertmanager'
import { CURRENT_USER } from './alertmanagerConstants'
import type { RouteMode, RouteNode, RouteTreeData } from '../../types/alertmanager'
import {
  emptyRouteTree,
  flattenRouteTree,
  fromRouteNodes,
  generateRouteSection,
  mergeRouteSection,
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
  reload: () => void
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

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await alertmanagerRoutesApi.getRoutes()
        if (cancelled) return
        setData(res.data ?? null)
        setError(null)
      } catch (e) {
        if (cancelled) return
        setData(null)
        setError(e instanceof Error ? e.message : '加载路由规则失败，请稍后重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const rows = useMemo(() => (data?.items ? buildRouteRows(data.items) : []), [data])
  return { data, rows, loading, error, reload }
}

// =====================================================================
// 编辑态（T08-F11）
// =====================================================================

/**
 * 导入结果状态：
 * - `empty`：尚未导入（页面初始态，不渲染编辑区）；
 * - `imported`：完整导入（后端解析成功，字段无损）；
 * - `partial`：不可无损导入（后端解析失败 / 无 route 段），已给空白起点供手动校正。
 */
export type RouteImportState = 'empty' | 'imported' | 'partial'

export interface UseRouteEditorOptions {
  /** 只读视图解析出的路由节点（解析失败时缺省） */
  sourceItems?: RouteNode[]
  /** 后端解析失败原因（存在即不可无损导入） */
  parseError?: string
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
  saving: boolean
  /** 保存结果提示（成功 / 失败），未保存为 null */
  saveResult: { ok: boolean; message: string } | null
  /** 从当前配置导入（解析失败时降级为空白起点 + 提示） */
  importFromCurrent: () => void
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
 * 编辑态 Hook：导入 / 顺序调整 / 删除 / 预检 / 保存。
 *
 * 保存链路（零新增端点）：`generateRouteSection(tree)` → `GET /config/current`（基座原文）→
 * `mergeRouteSection` → `POST /config`（服务端 amtool 校验 + 落库 + 触发 M09 变更单）。
 */
export function useRouteEditor(options: UseRouteEditorOptions = {}): UseRouteEditorResult {
  const { sourceItems, parseError, rawYAML = '', onSaved, confirmPartialImport } = options
  const [tree, setTree] = useState<RouteEditNode[]>([])
  const [importState, setImportState] = useState<RouteImportState>('empty')
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [knownReceivers, setKnownReceivers] = useState<string[]>([])

  // 可用接收人（knownReceivers）= 已启用渠道的派生接收人名（H1 验收 #1：非管理员也能获得）。
  // 改用「批量、非 admin」的 `notifyChannelsApi.list()`：其响应已含各渠道物化的 AM receiver 名
  // （`receiver_name`，与 M09 生成器同源、非敏感），一次请求即可拿到全部已知接收人清单，
  // 不再逐渠道调用 admin-only 的 `getReceiverSnippet`（N+1、非管理员取不到 → 接收人校验失效）。
  // 取数失败 / 无权限时降级为空集合（**不阻断**，仅表示无法判定悬空）。
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await notifyChannelsApi.list()
        const names = (res.data?.items ?? [])
          .filter((c) => c.enabled && c.receiver_name)
          .map((c) => c.receiver_name as string)
        if (!cancelled) setKnownReceivers(names)
      } catch {
        if (!cancelled) setKnownReceivers([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const importFromCurrent = useCallback(() => {
    setSaveResult(null)
    if ((parseError ?? '').trim()) {
      // 后端 T08-12 对不可表达结构 return error（无 raw 标注通道）→ 不可无损导入：
      // 给空白根路由起点 + 明示提示 + 原文可对照，允许用户手动校正补齐。
      setTree(emptyRouteTree())
      setImportState('partial')
      setImportNotice(
        `当前 route 段无法被平台完整解析，已按空白根路由导入（可在下方手动校正补齐）：${parseError}`,
      )
      return
    }
    if (!sourceItems || sourceItems.length === 0) {
      setTree(emptyRouteTree())
      setImportState('partial')
      setImportNotice('当前没有生效的 route 配置可导入，已按空白根路由导入，可在下方手动补齐。')
      return
    }
    setTree(fromRouteNodes(sourceItems))
    setImportState('imported')
    setImportNotice(`已从当前配置导入 ${sourceItems.length} 个路由节点（名称经注释还原），请确认后再保存。`)
  }, [parseError, sourceItems])

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

  const save = useCallback(async (): Promise<boolean> => {
    setSaveResult(null)
    if (tree.length === 0) {
      setSaveResult({ ok: false, message: '请先「从当前配置导入」或新建路由规则，再保存。' })
      return false
    }
    const errors = [...validateRouteTree(tree), ...validateRouteReceivers(tree, knownReceivers)].filter(
      (i) => i.level === 'error',
    )
    if (errors.length > 0) {
      setSaveResult({ ok: false, message: `保存前预检未通过（${errors.length} 项）：${errors[0].message}` })
      return false
    }
    // H4：部分导入（importState === 'partial'）保存护栏——只补齐了子集路由，覆盖式保存可能改写
    // 当前生效配置中原有的 route 段，必须先经二次确认 / 差异预览，确认后才真正提交（非破坏性默认）。
    if (importState === 'partial') {
      const confirmed = confirmPartialImport ? await confirmPartialImport() : true
      if (!confirmed) {
        setSaveResult({
          ok: false,
          message: '已取消保存：部分导入覆盖式保存会改写原有路由段，需二次确认后才能提交。',
        })
        return false
      }
    }
    setSaving(true)
    try {
      const routeYAML = generateRouteSection(tree)
      // C1：合并基取自 admin「生效产品视图」端点 GET /config/product（含平台物化 receivers，
      // 与后端 EffectiveAlertmanagerYAML 契约一致）。该端点是 RequireAdmin——而保存提交
      // POST /config 本就 RequireAdmin，故保存链路整体 admin 一致：非 admin 仅能查看/编辑，
      // 不能提交（H1 只修复非 admin 的接收人下拉，未放宽提交权限）。回落到同样 admin 的
      // /config/current 挂载留痕。绝不把含凭据的 effective YAML 暴露到非 admin 的 GET /routes。
      let base = ''
      try {
        const product = await alertmanagerConfigApi.getProduct()
        base = product.data?.yaml ?? ''
      } catch {
        base = ''
      }
      if (!base) {
        try {
          const current = await alertmanagerConfigApi.getCurrent()
          base = current.data?.content ?? ''
        } catch {
          base = ''
        }
      }
      const merged = mergeRouteSection(base, routeYAML)
      await alertmanagerConfigApi.submit({ content: merged, uploaded_by: CURRENT_USER })
      setSaveResult({
        ok: true,
        message: '已生成整份 alertmanager.yml 并提交挂载，进入变更单人工确认后下发生效（不即时生效）。',
      })
      onSaved?.()
      return true
    } catch (e) {
      setSaveResult({
        ok: false,
        message: e instanceof Error ? `保存失败：${e.message}` : '保存失败，请稍后重试',
      })
      return false
    } finally {
      setSaving(false)
    }
  }, [tree, knownReceivers, onSaved, importState, confirmPartialImport])

  return {
    tree,
    rows,
    importState,
    importNotice,
    rawYAML,
    issues,
    blocking,
    warnings,
    knownReceivers,
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

/** 模式徽标是否可写（T08-F12：仅 `managed` 模式本页可写，「handwritten」模式只读） */
export function isRouteEditable(mode: RouteMode): boolean {
  return mode === 'managed'
}
