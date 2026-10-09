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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  /**
   * 加载是否已到终态（成功或降级皆为 true）。
   * 供 `useRouteEditor` 的首屏自动导入门控——在 loading 期间不得导入（此刻既无只读树
   * 也无从判断是否解析失败），否则会先闪一棵空白树再被真实数据替换。
   */
  ready: boolean
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
  // 失败也算终态：否则网络错误时页面会永远停在「未就绪」，编辑区永不出现。
  return { data, rows, loading, error, ready: !loading, reload }
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
  /**
   * 只读视图解析失败原因（存在即不可无损导入）。
   * 同时充当「首屏自动导入」的触发条件：解析失败时**不**自动导入，交由用户显式点
   * 「从当前配置导入」走「部分导入 + 手动校正」通道（自动塞一棵空白树会掩盖降级事实）。
   */
  parseError?: string
  /**
   * 只读视图是否已加载完成（含成功与降级两种终态）。
   *
   * 首屏自动导入的门控（2026-10-08）：此前 `importState` 恒从 'empty' 起步，而页面
   * 「新建路由规则」「保存并提交变更」按钮都是 `disabled={!editing}`（editing =
   * importState !== 'empty'）→ 首屏两个主按钮恒灰，用户必须先点「从当前配置导入」
   * 才能开始编辑，而该按钮的语义（「从零开始的空白起点」）与它的实际门槛不匹配，
   * 造成「新建按钮永远是灰的」观感。后端首屏已返回完整只读树，数据已在手，
   * 故改为**加载完成即自动导入**；用户后续点同一按钮 = 显式「重新载入」（二次确认）。
   */
  ready?: boolean
  /**
   * 生效配置 `receivers:` 段已声明的接收人名（GET /routes 的 `declared_receivers`，
   * **含用户手写**）。与下方平台物化名共同构成「合法接收人」判据。
   *
   * ⚠ 缺此字段会让手写 receiver 被误判悬空（2026-10-08 实测阻断）：此前 knownReceivers
   * 只取平台物化名，而生效配置里手写的 `feishu` 被 5 个路由节点引用 → 全被判「未定义」
   * → 既不能保存也不能新建。口径须与 generator/notify_route_skeleton.go 的
   * 「可达 receiver 集合 = 文件 receivers ∪ PlatformReceiverNames」一致。
   */
  declaredReceivers?: string[]
  /** 解析失败时的 alertmanager.yml 原文（供手动校正时对照） */
  rawYAML?: string
  /** 保存成功后回调（页面用于刷新只读视图 / 提示） */
  onSaved?: () => void
  /**
   * 部分导入（importState === 'partial'）保存前的确认回调（H4 护栏）。
   * 返回 true 才真正保存；false 中止保存。不传则默认直接保存（页面层应注入基于 antd Modal 的实现）。
   */
  confirmPartialImport?: () => Promise<boolean>
  /**
   * 「重新载入」二次确认回调：会丢弃当前未保存的编辑，返回 true 才继续。
   * 不传则默认直接重新载入（不推荐）。
   */
  confirmReload?: () => Promise<boolean>
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
  /**
   * 从当前配置导入 / 重新载入。
   * 首屏由 ready + sourceItems 自动触发一次（见下方 useEffect），此后仅由用户点击触发；
   * 已有编辑时先经 `confirmReload` 二次确认（丢弃编辑属破坏性操作，不做静默覆盖）。
   */
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
  const {
    sourceItems,
    parseError,
    rawYAML = '',
    ready = false,
    onSaved,
    confirmPartialImport,
    confirmReload,
  } = options
  const [tree, setTree] = useState<RouteEditNode[]>([])
  const [importState, setImportState] = useState<RouteImportState>('empty')
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ ok: boolean; message: string } | null>(null)

  /** 文件 receivers: 段已声明的接收人名（GET /routes 的 declared_receivers；含用户手写） */
  const declaredReceivers = useMemo(
    () => (options.declaredReceivers ?? []).map((n) => (n ?? '').trim()).filter((n) => n !== ''),
    [options.declaredReceivers],
  )

  // 可用接收人（knownReceivers）= **文件 receivers: 段已声明名 ∪ 平台物化名**。
  //
  // ⚠ 口径修复（2026-10-08 实测阻断）：此前只取「已启用渠道派生名」，导致用户手写在
  // receivers: 段里的 receiver 被判悬空。实测生效配置中手写 `feishu` 与平台 `notify-1`
  // 共存，而根路由 + 4 条子路由全部引用 `feishu` → 5 个节点全命中 `receiver_dangling`，
  // 页面既不能保存也不能新建（死锁）。
  //
  // 两个来源各司其职：
  //   - `declared_receivers`（GET /routes，带外/带内的文件声明全集）——「合法接收人」判据；
  //   - 已启用渠道派生名 —— 平台将要物化的名字，文件里此刻可能还没写（生成时才落盘），
  //     故必须并入，否则「渠道已开但配置尚未重新生成」会被误判悬空。
  // 二者的并集与生成侧口径一致（generator/notify_route_skeleton.go 的「可达 receiver 集合
  // = 文件 receivers ∪ PlatformReceiverNames」），此前前端是这套口径的唯一例外（属漂移）。
  //
  // 任一来源取数失败即降级为「该来源为空」；两者都空时集合 size 为 0，
  // validateRouteReceivers 直接返回 []（不判悬空），不会误阻断。
  const [platformReceivers, setPlatformReceivers] = useState<string[]>([])

  // 批量、非 admin 的 `notifyChannelsApi.list()`：响应已含各渠道物化的 AM receiver 名
  // （`receiver_name`，与 M09 生成器同源、非敏感），一次请求即可拿到全部平台物化名，
  // 不逐渠道调用 admin-only 的 `getReceiverSnippet`（N+1、非管理员取不到 → 校验失效）。
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const res = await notifyChannelsApi.list()
        const names = (res.data?.items ?? [])
          .filter((c) => c.enabled && c.receiver_name)
          .map((c) => c.receiver_name as string)
        if (!cancelled) setPlatformReceivers(names)
      } catch {
        if (!cancelled) setPlatformReceivers([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const knownReceivers = useMemo(() => {
    const out = new Set<string>()
    for (const n of declaredReceivers) if (n) out.add(n)
    for (const n of platformReceivers) if (n) out.add(n)
    return Array.from(out)
  }, [declaredReceivers, platformReceivers])

  /** 实际执行导入（不含二次确认；自动导入与用户点击共用，保证两条路径语义完全一致） */
  const doImport = useCallback(() => {
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

  /**
   * 首屏自动导入：只读视图加载完成（ready）且**解析成功**时，把只读树灌进编辑态。
   *
   * 为什么必须有（2026-10-08）：页面「新建路由规则」/「保存并提交变更」都是
   * `disabled={!editing}`，editing 依赖 importState !== 'empty'。此前 importState 恒从
   * 'empty' 起步 ⇒ 两个主按钮首屏恒灰 ⇒ 用户必须先点「从当前配置导入」才能动手，
   * 而那按钮在首屏语境下更像「可选的导入动作」而非「开始编辑的前置步骤」，
   * 于是「新建按钮永远是灰的」成为实测阻断缺陷。
   *
   * 两条护栏：
   *   1. **仅在 ready 之后触发一次**（用 autoImportedRef 幂等锁），避免 reload 后反复重置
   *      用户正在进行的编辑；
   *   2. **解析失败不自动导入**——降级为「部分导入 + 手动校正」是用户需要知晓的事实，
   *      静默塞一棵空白树会让降级不可见；此时由用户显式点击触发，路径与语义都更清楚。
   */
  const autoImportedRef = useRef(false)
  useEffect(() => {
    if (!ready || autoImportedRef.current) return
    if ((parseError ?? '').trim()) return
    autoImportedRef.current = true
    doImport()
  }, [ready, parseError, doImport])

  /** 用户显式点击：已有未保存编辑时先二次确认（丢弃编辑是破坏性操作） */
  const importFromCurrent = useCallback(() => {
    const hasUnsavedEdits = tree.length > 0
    if (!hasUnsavedEdits) {
      doImport()
      return
    }
    const run = () => {
      // 重新载入后把幂等锁重新置位：reload() 会带回新数据，届时应再自动同步一次。
      autoImportedRef.current = true
      doImport()
    }
    if (!confirmReload) {
      run()
      return
    }
    void confirmReload().then((ok) => {
      if (ok) run()
    })
  }, [tree.length, confirmReload, doImport])

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
    // 「放弃编辑」后需要能重新进入编辑态：置回 false 让首屏自动导入的条件重新可满足，
    // 否则 reset 之后页面会退回到「按钮恒灰」的老症状（若期间只读树有新数据的话，
    // 下一次 reload 就能自动再同步；无新数据时用户仍可点「重新载入」显式进入）。
    autoImportedRef.current = false
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
        message:
          '已生成整份 alertmanager.yml 并提交挂载。改动不会自动生效——请前往「配置变更确认」人工确认，确认后才会写入并 reload Alertmanager。',
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
