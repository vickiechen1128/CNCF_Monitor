/**
 * 「路由规则」页 v0.3-b 编辑态树模型与纯函数（T08-F11）。
 *
 * 契约口径镜像后端 T08-13：
 * - `platform/configcenter/generator/notify_route_generate.go`（`RouteEditNode` / `RouteEditMatcher`
 *   / `GenerateRouteSection` / `MergeRouteSection`）——树模型因 import 环镜像在 generator 侧；
 * - `platform/alertmanager/route/validate.go`（`ValidateRouteTree` / `RouteIssue` / `ParseRouteDuration`）。
 *
 * ⚠️ 重要口径（与后端逐条对齐，改动前先看 Go 侧注释）：
 *  1. `enabled` 为编辑态开关、**不落盘**；`false` 的节点**及其整条子树**在生成时整条剔除。
 *     Go 零值为 false，故**导入侧必须显式置 true**（`fromRouteNodes`），否则整棵树被剔除。
 *  2. 顺序 = **同层节点的数组位置**（忽略 `order`）；上移/下移直接改数组顺序。
 *  3. `matchers` 固定落 **AM 字符串简写**（`=`/`!=`/`=~`/`!~`）——本机 amtool 0.34 不接受 map 形态。
 *  4. `name` 以注释 `# 路由名称: xxx` 落盘于节点上方（AM 无 name 字段）。
 *  5. 编辑态字段 `id` / `parent_id` / `order` / `enabled` **一律不落盘**。
 *
 * 归属边界：本文件是**纯函数**（无 React、无 API、无第三方 yaml 依赖）；生成 / 合并 / 校验的
 * 权威实现在后端 Go 侧，此处为「保存走既有挂载端点、零新增端点」所需的前端镜像，**语义须与 Go
 * 保持一致**——Go 侧口径变更时本文件必须同步（建议在汇报中标注为后端增量的收敛点）。
 */
import type { RouteMatcher, RouteNode } from '../../types/alertmanager'

/** 顶层路由（根）节点 ID：对应 AM 的 `route:` 本体，不可删、不可移 */
export const ROUTE_ROOT_ID = 'root'

/** 路由名称注释前缀（与 Go `routeNameCommentPrefix` 严格对称）：`# 路由名称: xxx` */
export const ROUTE_NAME_COMMENT_PREFIX = '路由名称'

/** 编辑态单条匹配条件（口径与后端 `RouteEditMatcher` / `route.RouteMatcher` 一致） */
export interface RouteEditMatcher {
  name: string
  value: string
  /** true=`=` / `=~`（相等）；false=`!=` / `!~`（取反） */
  is_equal: boolean
  /** true=正则匹配（`=~` / `!~`） */
  is_regex: boolean
}

/**
 * 编辑态路由节点（前序扁平序列，`items[0]` 为根路由）。
 *
 * `id` / `parent_id` / `order` 为平台编辑态内部标识（不落盘）；`raw_yaml` 承载不可表达子树的原文
 * （前端导入路径不产 raw，保留字段以对齐后端模型）。
 */
export interface RouteEditNode {
  id: string
  parent_id: string
  name: string
  matchers: RouteEditMatcher[]
  receiver: string
  group_by: string[]
  group_wait: string
  group_interval: string
  repeat_interval: string
  continue: boolean
  order: number
  /** ⚠ 导入时必须显式置 true（Go 零值脚枪：false 会连子树一起剔除） */
  enabled: boolean
  raw_yaml: string
}

/** 校验结论等级（与后端同枚举）：error = 阻断保存；warning = 仅提示 */
export type RouteIssueLevel = 'error' | 'warning'

/** 校验码（稳定枚举，供 UI 映射文案；与后端 `validate.go` 同名常量一一对应） */
export const ROUTE_ISSUE_CODES = {
  rootReceiverRequired: 'root_receiver_required',
  rootMatchersForbidden: 'root_matchers_forbidden',
  matcherNameEmpty: 'matcher_name_empty',
  matcherRegexInvalid: 'matcher_regex_invalid',
  durationInvalid: 'duration_invalid',
  repeatNotMultiple: 'repeat_interval_not_multiple_of_group_interval',
  /** 前端侧预检（后端无此码）：接收人引用未启用 / 不存在的渠道 */
  receiverDangling: 'receiver_dangling',
} as const

/** 单条校验结论（字段名对齐后端 `RouteIssue`，snake_case） */
export interface RouteIssue {
  level: RouteIssueLevel
  code: string
  node_id: string
  field: string
  message: string
}

// =====================================================================
// 时长解析（镜像 `route.ParseRouteDuration`）
// =====================================================================

/** AM 时长单位 → 毫秒（model.Duration 口径：w=7d、y=365d） */
const ROUTE_DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
}

/** 单个「数值 + 单位」片段（`ms` 必须优先于 `m` / `s`） */
const ROUTE_DURATION_TOKEN_RE = /^(\d+)(ms|y|w|d|h|m|s)/

/**
 * 解析 AM 时长为毫秒（支持 ms/s/m/h/d/w/y 及其组合，如 `1h30m`）；非法返回 null。
 * 空串视为非法——「未设置」由调用方用 `parseRouteDurationIfSet` 放行。
 */
export function parseRouteDuration(raw: string): number | null {
  let s = (raw ?? '').trim()
  if (s === '') return null
  if (s === '0') return 0
  let total = 0
  while (s.length > 0) {
    const m = ROUTE_DURATION_TOKEN_RE.exec(s)
    if (!m) return null
    total += Number(m[1]) * ROUTE_DURATION_UNIT_MS[m[2]]
    s = s.slice(m[0].length)
  }
  return total
}

/** 解析「可空」时长字段：空串视为未设置（`0, true`），与后端 `parseRouteDurationIfSet` 同口径 */
function parseRouteDurationIfSet(raw: string): { ms: number; ok: boolean } {
  if ((raw ?? '').trim() === '') return { ms: 0, ok: true }
  const ms = parseRouteDuration(raw)
  return ms === null ? { ms: 0, ok: false } : { ms, ok: true }
}

// =====================================================================
// 校验（镜像 `route.ValidateRouteTree`）
// =====================================================================

/** 节点的时长字段（落盘键名 → 值），供逐字段校验复用 */
const DURATION_FIELDS: { key: 'group_wait' | 'group_interval' | 'repeat_interval'; label: string }[] = [
  { key: 'group_wait', label: '初次等待' },
  { key: 'group_interval', label: '分组间隔' },
  { key: 'repeat_interval', label: '重复间隔' },
]

/**
 * 校验编辑态路由树，返回结论集合（**不阻断**：由调用方按 level 决定处置）。
 *
 * 与后端逐条对齐：
 * - 根路由必须有兜底 receiver / 不得带 matchers（error）；
 * - matcher 标签名空 / 正则值非法（error）——正则用 `RegExp` 预编译校验；
 * - 时长非法（error）；
 * - `repeat_interval` 不是 `group_interval` 整数倍 → **warning**（AM 会向上取整，不阻断保存）。
 */
export function validateRouteTree(nodes: RouteEditNode[]): RouteIssue[] {
  const issues: RouteIssue[] = []
  if (!nodes || nodes.length === 0) return issues

  const root = nodes.find((n) => n.parent_id === '') ?? nodes[0]
  if (!root.receiver.trim()) {
    issues.push({
      level: 'error',
      code: ROUTE_ISSUE_CODES.rootReceiverRequired,
      node_id: root.id,
      field: 'receiver',
      message: '根路由必须指定兜底接收人（Alertmanager 要求 root route must specify a default receiver）',
    })
  }
  if (root.matchers.length > 0) {
    issues.push({
      level: 'error',
      code: ROUTE_ISSUE_CODES.rootMatchersForbidden,
      node_id: root.id,
      field: 'matchers',
      message: '根路由不得设置匹配条件（Alertmanager 要求 root route must not have any matchers）',
    })
  }
  for (const node of nodes) issues.push(...validateRouteNodeFields(node))
  return issues
}

/** 单节点字段校验（matchers + 三个时长字段 + 整除警告） */
export function validateRouteNodeFields(node: RouteEditNode): RouteIssue[] {
  const issues: RouteIssue[] = []

  for (const m of node.matchers ?? []) {
    if (!(m.name ?? '').trim()) {
      issues.push({
        level: 'error',
        code: ROUTE_ISSUE_CODES.matcherNameEmpty,
        node_id: node.id,
        field: 'matchers',
        message: '匹配条件的标签名不能为空',
      })
      continue
    }
    if (m.is_regex) {
      if (!isCompilableRegex(m.value)) {
        issues.push({
          level: 'error',
          code: ROUTE_ISSUE_CODES.matcherRegexInvalid,
          node_id: node.id,
          field: 'matchers',
          message: `匹配条件 "${m.name}" 的正则值 "${m.value}" 非法，请修正后再保存`,
        })
      }
    }
  }

  const parsed = new Map<string, { ms: number; ok: boolean }>()
  for (const f of DURATION_FIELDS) {
    const r = parseRouteDurationIfSet(node[f.key] ?? '')
    parsed.set(f.key, r)
    if (!r.ok) {
      issues.push({
        level: 'error',
        code: ROUTE_ISSUE_CODES.durationInvalid,
        node_id: node.id,
        field: f.key,
        message: `${f.label} 的值 "${node[f.key]}" 不是合法的时长（支持 ms/s/m/h/d/w/y 及其组合，如 30s / 1h30m）`,
      })
    }
  }
  const wait = parsed.get('group_wait')!
  const interval = parsed.get('group_interval')!
  const repeat = parsed.get('repeat_interval')!
  // 提案 §3.4 / §6 验收 6：不整除时 AM 会向上取整，故仅警告级，绝不阻断保存。
  if (wait.ok && interval.ok && repeat.ok && interval.ms > 0 && repeat.ms % interval.ms !== 0) {
    issues.push({
      level: 'warning',
      code: ROUTE_ISSUE_CODES.repeatNotMultiple,
      node_id: node.id,
      field: 'repeat_interval',
      message: `重复间隔 ${node.repeat_interval} 不是分组间隔 ${node.group_interval} 的整数倍，Alertmanager 会向上取整到分组间隔的整数倍（可保存，如需精确节奏请调整分组间隔）`,
    })
  }
  return issues
}

/**
 * 接收人悬空预检（PRD §11.7：渠道被禁用导致引用悬空 → 红字 + 保存阻断）。
 *
 * `knownReceivers` 由「已启用通知渠道」派生；**取不到清单时不判定**（避免把平台未知的手写
 * receiver 误判为悬空），由调用方决定是否提示。
 */
export function validateRouteReceivers(
  nodes: RouteEditNode[],
  knownReceivers: string[],
): RouteIssue[] {
  if (knownReceivers.length === 0) return []
  const issues: RouteIssue[] = []
  for (const node of nodes ?? []) {
    const receiver = (node.receiver ?? '').trim()
    if (!receiver || knownReceivers.includes(receiver)) continue
    issues.push({
      level: 'error',
      code: ROUTE_ISSUE_CODES.receiverDangling,
      node_id: node.id,
      field: 'receiver',
      message: `接收人「${receiver}」未定义（对应通知渠道未启用或已删除），告警将无处可发`,
    })
  }
  return issues
}

function isCompilableRegex(value: string): boolean {
  try {
    new RegExp(value ?? '')
    return true
  } catch {
    return false
  }
}

/** 判定结论集合中是否存在阻断级（error）结论（镜像 `route.HasBlockingIssue`） */
export function hasBlockingIssue(issues: RouteIssue[]): boolean {
  return (issues ?? []).some((i) => i.level === 'error')
}

// =====================================================================
// 导入：只读视图 RouteNode → 编辑态 RouteEditNode
// =====================================================================

/**
 * 把后端只读路由树（`GET /routes` 的 `items`）转换为编辑态树，作为「从当前配置导入」的表单初始值。
 *
 * ⚠️ `enabled` **显式置 true**（Go 零值脚枪：漏置会让整棵树在生成时被剔除）；
 * `name` 已由后端经 `# 路由名称:` 注释还原（存量手写文件写在 `route:` 键上方的注释后端暂读不回，
 * 此处保持空串、绝不造值）。
 */
export function fromRouteNodes(items: RouteNode[]): RouteEditNode[] {
  return (items ?? []).map((n) => ({
    id: n.id,
    parent_id: n.parent_id ?? '',
    name: n.name ?? '',
    matchers: (n.matchers ?? []).map((m: RouteMatcher) => ({
      name: m.name ?? '',
      value: m.value ?? '',
      is_equal: m.is_equal !== false,
      is_regex: m.is_regex === true,
    })),
    receiver: n.receiver ?? '',
    group_by: [...(n.group_by ?? [])],
    group_wait: n.group_wait ?? '',
    group_interval: n.group_interval ?? '',
    repeat_interval: n.repeat_interval ?? '',
    continue: n.continue === true,
    order: n.order ?? 0,
    enabled: true,
    raw_yaml: '',
  }))
}

/** 空白起点：仅一个根路由（用于「不可无损导入」后的手动校正） */
export function emptyRouteTree(): RouteEditNode[] {
  return [blankRouteNode(ROUTE_ROOT_ID, '')]
}

/** 空白节点模板（新建子路由沿用提案 §3.4 的常用节奏默认值） */
export function blankRouteNode(id: string, parentId: string): RouteEditNode {
  return {
    id,
    parent_id: parentId,
    name: '',
    matchers: [],
    receiver: '',
    group_by: [],
    group_wait: '30s',
    group_interval: '5m',
    repeat_interval: '4h',
    continue: false,
    order: 0,
    enabled: true,
    raw_yaml: '',
  }
}

// =====================================================================
// 树操作（顺序 = 同层数组顺序）
// =====================================================================

/** 生成下一个节点 ID（`parent/<同层下标>`，与后端只读解析的同构命名保持一致） */
export function nextRouteId(tree: RouteEditNode[], parentId: string): string {
  const siblings = (tree ?? []).filter((n) => n.parent_id === parentId)
  const base = parentId === '' ? ROUTE_ROOT_ID : `${parentId}/${siblings.length}`
  let id = base
  let seq = 1
  const taken = new Set((tree ?? []).map((n) => n.id))
  while (taken.has(id)) id = `${base}-${seq++}`
  return id
}

/** 按 `parent_id` + 数组顺序重建前序序列（根恒置顶） */
export function flattenRouteTree(nodes: RouteEditNode[]): RouteEditNode[] {
  const byParent = new Map<string, RouteEditNode[]>()
  for (const n of nodes ?? []) {
    const arr = byParent.get(n.parent_id)
    if (arr) arr.push(n)
    else byParent.set(n.parent_id, [n])
  }
  const out: RouteEditNode[] = []
  const walk = (parentId: string) => {
    for (const n of byParent.get(parentId) ?? []) {
      out.push(n)
      walk(n.id)
    }
  }
  const roots = byParent.get('') ?? []
  if (roots.length > 0) {
    out.push(roots[0])
    walk(roots[0].id)
  }
  return out
}

/** 统计子节点（含所有后代，**不含自身**）——删除二次确认的「将同时删除 N 条子路由」用 */
export function countDescendants(tree: RouteEditNode[], id: string): number {
  const childrenOf = new Map<string, string[]>()
  for (const n of tree ?? []) {
    const arr = childrenOf.get(n.parent_id)
    if (arr) arr.push(n.id)
    else childrenOf.set(n.parent_id, [n.id])
  }
  let count = 0
  const stack = [...(childrenOf.get(id) ?? [])]
  while (stack.length > 0) {
    const cur = stack.pop()!
    count += 1
    stack.push(...(childrenOf.get(cur) ?? []))
  }
  return count
}

/** 收集子树 ID（含自身） */
export function collectSubtreeIds(tree: RouteEditNode[], id: string): string[] {
  const ids: string[] = []
  const childrenOf = new Map<string, string[]>()
  for (const n of tree ?? []) {
    const arr = childrenOf.get(n.parent_id)
    if (arr) arr.push(n.id)
    else childrenOf.set(n.parent_id, [n.id])
  }
  const stack = [id]
  while (stack.length > 0) {
    const cur = stack.pop()!
    ids.push(cur)
    stack.push(...(childrenOf.get(cur) ?? []))
  }
  return ids
}

/** 删除节点及其整条子树 */
export function removeSubtree(tree: RouteEditNode[], id: string): RouteEditNode[] {
  const doomed = new Set(collectSubtreeIds(tree, id))
  return (tree ?? []).filter((n) => !doomed.has(n.id))
}

/**
 * 同层重排：把 `fromId` 移到 `toId` 的位置（拖拽落点）。
 * 仅当两者同父时生效；顺序由数组位置承载，重排后按前序重建整棵树。
 */
export function reorderSibling(tree: RouteEditNode[], fromId: string, toId: string): RouteEditNode[] {
  const from = (tree ?? []).find((n) => n.id === fromId)
  const to = (tree ?? []).find((n) => n.id === toId)
  if (!from || !to || from.parent_id !== to.parent_id || from.id === to.id) return tree ?? []

  const rest = (tree ?? []).filter((n) => n.parent_id !== from.parent_id)
  const siblings = (tree ?? []).filter((n) => n.parent_id === from.parent_id)
  const fi = siblings.findIndex((n) => n.id === fromId)
  const ti = siblings.findIndex((n) => n.id === toId)
  if (fi < 0 || ti < 0) return tree ?? []
  const next = [...siblings]
  const [moved] = next.splice(fi, 1)
  next.splice(ti, 0, moved)
  return flattenRouteTree([...rest, ...next])
}

/** 上移 / 下移一格（根路由不可移动；已是首/末位时原样返回） */
export function moveSibling(tree: RouteEditNode[], id: string, dir: -1 | 1): RouteEditNode[] {
  const node = (tree ?? []).find((n) => n.id === id)
  if (!node || node.parent_id === '') return tree ?? []
  const siblings = (tree ?? []).filter((n) => n.parent_id === node.parent_id)
  const idx = siblings.findIndex((n) => n.id === id)
  const target = siblings[idx + dir]
  if (idx < 0 || !target) return tree ?? []
  return reorderSibling(tree, id, target.id)
}

/** 新增 / 更新节点（按 id 匹配；不存在则追加到末尾） */
export function upsertNode(tree: RouteEditNode[], node: RouteEditNode): RouteEditNode[] {
  const list = tree ?? []
  const idx = list.findIndex((n) => n.id === node.id)
  if (idx < 0) return flattenRouteTree([...list, node])
  const next = [...list]
  next[idx] = node
  return next
}

/** 判断目标是否可作为父路由（不能选自己及其后代，否则成环） */
export function canBeParent(tree: RouteEditNode[], nodeId: string, candidateId: string): boolean {
  if (!nodeId || nodeId === candidateId) return false
  return !collectSubtreeIds(tree, nodeId).includes(candidateId)
}

// =====================================================================
// 生成 route 段 YAML（镜像 `generator.GenerateRouteSection`）
// =====================================================================

/** 缩进单位（2 空格；YAML 语义与 Go 的 4 空格产物等价） */
const INDENT_UNIT = '  '

function indentOf(units: number): string {
  return INDENT_UNIT.repeat(Math.max(units, 0))
}

/** 单引号包裹（YAML 单引号样式：内部 `'` 需双倍转义） */
function singleQuote(value: string): string {
  return `'${String(value ?? '').replace(/'/g, "''")}'`
}

/** matcher → AM 字符串简写 `name<op>"value"`（值含双引号时改用单引号包裹） */
export function matcherShorthand(m: RouteEditMatcher): string {
  let op = '='
  if (m.is_regex && m.is_equal) op = '=~'
  else if (m.is_regex && !m.is_equal) op = '!~'
  else if (!m.is_regex && !m.is_equal) op = '!='
  const quote = String(m.value ?? '').includes('"') ? "'" : '"'
  return `${m.name}${op}${quote}${m.value}${quote}`
}

interface RouteEditTreeIndex {
  nodes: RouteEditNode[]
  byId: Map<string, RouteEditNode>
  children: Map<string, RouteEditNode[]>
  rootId: string
}

/**
 * 建立编辑态树索引并做结构体检：ID 唯一、唯一根、父节点存在、全部节点从根可达
 * （杜绝孤立 / 成环导致的静默丢弃），与 Go `indexRouteEditTree` 同口径。
 */
function indexRouteEditTree(tree: RouteEditNode[]): RouteEditTreeIndex {
  const byId = new Map<string, RouteEditNode>()
  for (const n of tree) {
    if (byId.has(n.id)) throw new Error(`编辑态路由树存在重复节点 ID "${n.id}"`)
    byId.set(n.id, n)
  }
  const children = new Map<string, RouteEditNode[]>()
  let rootId = ''
  for (const n of tree) {
    if (n.parent_id === '') {
      if (rootId) throw new Error('编辑态路由树存在多个根节点（AM 语义为有序单根）')
      rootId = n.id
      continue
    }
    if (!byId.has(n.parent_id)) {
      throw new Error(`编辑态路由树节点 "${n.id}" 的父节点 "${n.parent_id}" 不存在（孤立节点，拒绝静默丢弃）`)
    }
    const arr = children.get(n.parent_id)
    if (arr) arr.push(n)
    else children.set(n.parent_id, [n])
  }
  if (!rootId) throw new Error('编辑态路由树缺少根节点（parent_id 为空的节点）')

  const reached = new Set<string>()
  const stack = [rootId]
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (reached.has(cur)) continue
    reached.add(cur)
    for (const c of children.get(cur) ?? []) stack.push(c.id)
  }
  if (reached.size !== tree.length) {
    throw new Error(`编辑态路由树存在从根不可达的节点（${reached.size}/${tree.length} 可达），拒绝静默丢弃`)
  }
  return { nodes: tree, byId, children, rootId }
}

/**
 * 把编辑态路由树生成为 route 段 YAML（含顶层 `route:` 键）。
 *
 * - `routes[]` 顺序 = 同层节点的数组顺序（界面顺序）；
 * - matchers 落 AM 字符串简写；`continue` 仅在 true 时输出；`group_by` 留空不输出该键；
 * - `name` 以 `# 路由名称: xxx` 注释落盘于节点上方；`id` / `parent_id` / `order` / `enabled` 不落盘；
 * - `enabled=false` 的节点**及其整条子树**整条剔除；
 * - 畸形树（空树 / 无根 / 多根 / 重复 ID / 孤立 / 根节点未启用）一律 throw，**绝不产出半截 route 段**。
 */
export function generateRouteSection(tree: RouteEditNode[]): string {
  if (!tree || tree.length === 0) throw new Error('编辑态路由树为空，无法生成 route 段')
  const idx = indexRouteEditTree(tree)
  if (!idx.byId.get(idx.rootId)!.enabled) {
    throw new Error('编辑态路由树根节点未启用，无法生成 route 段（AM 语义为有序单根）')
  }
  const lines: string[] = ['route:']
  const root = idx.byId.get(idx.rootId)!
  if (root.name.trim()) lines.push(`${indentOf(1)}# ${ROUTE_NAME_COMMENT_PREFIX}: ${root.name}`)
  lines.push(...buildRouteNodeLines(idx, idx.rootId, 1, new Set<string>()))
  return lines.join('\n') + '\n'
}

/**
 * 渲染单个 route 映射节点的行（键位于 `keyUnits` 缩进；`routes:` 子项在其 +2）。
 * 返回的**首行**由调用方按需要转换为序列项（`- `）。
 */
function buildRouteNodeLines(
  idx: RouteEditTreeIndex,
  id: string,
  keyUnits: number,
  visiting: Set<string>,
): string[] {
  const node = idx.byId.get(id)!
  if (visiting.has(id)) throw new Error(`编辑态路由树存在环路：节点 "${id}" 被重复引用`)
  visiting.add(id)
  try {
    if ((node.raw_yaml ?? '').trim() !== '') return rawRouteLines(node.raw_yaml, keyUnits)

    const lines: string[] = []
    if (node.matchers.length > 0) {
      lines.push(`${indentOf(keyUnits)}matchers:`)
      for (const m of node.matchers) lines.push(`${indentOf(keyUnits + 1)}- ${matcherShorthand(m)}`)
    }
    if (node.receiver) lines.push(`${indentOf(keyUnits)}receiver: ${singleQuote(node.receiver)}`)
    if (node.group_by.length > 0) {
      lines.push(`${indentOf(keyUnits)}group_by: [${node.group_by.join(', ')}]`)
    }
    if (node.group_wait) lines.push(`${indentOf(keyUnits)}group_wait: ${node.group_wait}`)
    if (node.group_interval) lines.push(`${indentOf(keyUnits)}group_interval: ${node.group_interval}`)
    if (node.repeat_interval) lines.push(`${indentOf(keyUnits)}repeat_interval: ${node.repeat_interval}`)
    if (node.continue) lines.push(`${indentOf(keyUnits)}continue: true`)

    const kids = (idx.children.get(id) ?? []).filter((k) => k.enabled)
    if (kids.length > 0) {
      lines.push(`${indentOf(keyUnits)}routes:`)
      for (const kid of kids) {
        if (kid.name.trim()) {
          lines.push(`${indentOf(keyUnits + 1)}# ${ROUTE_NAME_COMMENT_PREFIX}: ${kid.name}`)
        }
        const childLines = buildRouteNodeLines(idx, kid.id, keyUnits + 2, visiting)
        childLines[0] = `${indentOf(keyUnits + 1)}- ${childLines[0].slice(indentOf(keyUnits + 2).length)}`
        lines.push(...childLines)
      }
    }
    return lines
  } finally {
    visiting.delete(id)
  }
}

/** raw 原文按目标缩进原样回写（不可表达子树的回写通道，绝不静默丢弃） */
function rawRouteLines(raw: string, keyUnits: number): string[] {
  const base = indentOf(keyUnits)
  return raw
    .replace(/\s+$/, '')
    .split('\n')
    .map((line, i) => (i === 0 ? base + line.trimStart() : base + line))
}

// =====================================================================
// 合并：把生成的 route 段替换进整份 alertmanager.yml
// =====================================================================

/** 顶层 `route:` 键行（缩进 0） */
const TOP_LEVEL_ROUTE_KEY_RE = /^route\s*:/

/** 下一个顶层键 / 文档分隔符的起始行（缩进 0、非注释、非空） */
const TOP_LEVEL_KEY_RE = /^[^\s#-]/

/**
 * 把生成的 route 段（含顶层 `route:` 键）替换进 `baseYAML`：只替换顶层 `route:` 块，
 * 其余顶层段（global / receivers / inhibit_rules / templates / mute_time_intervals 等）
 * **逐字保留**（含注释与样式）——与 Go `MergeRouteSection` 语义一致。
 *
 * 实现说明：前端无 yaml 依赖（既有纪律），故按「缩进 0 的顶层键边界」做**文本级块替换**；
 * `baseYAML` 无 route 段时追加生成物而非丢弃。
 */
export function mergeRouteSection(baseYAML: string, generated: string): string {
  const gen = generated.replace(/\s+$/, '')
  if (!gen) throw new Error('生成的 route 段为空，拒绝合并')
  if (!(baseYAML ?? '').trim()) return gen + '\n'

  const lines = baseYAML.split('\n')
  const start = lines.findIndex((l) => TOP_LEVEL_ROUTE_KEY_RE.test(l))
  if (start < 0) {
    // 无 route 段（畸形存量文件）：追加生成物
    const base = baseYAML.replace(/\s+$/, '')
    return base + '\n' + gen + '\n'
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (/^\s/.test(line)) continue // 缩进 → 仍属 route 块
    if (/^#/.test(line)) continue // 顶层注释：保守视作 route 块内说明
    if (/^---\s*$/.test(line) || TOP_LEVEL_KEY_RE.test(line)) {
      end = i
      break
    }
  }
  const out = [...lines.slice(0, start), ...gen.split('\n'), ...lines.slice(end)].join('\n')
  return out.endsWith('\n') ? out : out + '\n'
}
