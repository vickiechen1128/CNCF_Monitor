/**
 * 「路由规则」页 v0.3-b（T08-F10 只读路由树 + T08-F11 三段式表单编辑）。
 *
 * 契约：Module_08 §11.7（列表态 / 编辑态）/ §9.1（v0.3-a / v0.3-b）；task-sequence T08-F10 / T08-F11。
 * 数据：`GET /api/v2/platform/alertmanager/routes`（T08-12，仅全局认证、只读无写能力）。
 *
 * 模式定位（PRD §11.7 L750-752 / 提案 §4.3「单一作者 + 模式开关」；门禁 `isRouteEditable`）：
 * - **平台生成**（managed，用户可见词）：本页可写——新建 / 编辑 / 删除 / 上移下移 / 拖拽 /
 *   保存并提交变更，保存 = 生成整份 alertmanager.yml → 复用既有 `POST /api/v2/platform/alertmanager/config`
 *   （**零新增端点**）→ 触发 M09 变更单，**不即时生效**；
 * - **我来编辑**（handwritten，用户可见词）：本页整体只读（无新建 / 编辑 / 拖拽入口），
 *   整份 route 由用户在告警配置页手写，本页只把文件里的 route 渲染成树帮用户看懂。
 *
 * 2026-10-13（提案 alert-config-policy-split-migration.md）：**路由设置常驻卡**迁入本页
 * （原在告警配置页「路由与收敛策略」卡）。两个控件与顶层路由同屏，避免用户改一处、
 * 另一处被后端 `materializeRootRouteReceiver` 静默覆盖：
 *   - 控件 A「路由规则由谁维护」= 本页 mode（Segmented，保留二次确认）；
 *   - 控件 B「没匹配到具体规则的告警，发给哪个渠道」= 顶层路由的兜底接收人（Select）。
 * 模式切「我来编辑」时兜底**自动置「不接管」**（决策二），并与模式合并进**同一次 PUT**
 * （决策三）；切回「平台生成」不自动接管（决策四）。
 *
 * ⚠ 2026-10-13 修正：本头注释与页面文案曾把两个模式的**页面可编辑性写反**（写成
 * handwritten=可写 / managed=只读），与门禁 `isRouteEditable`（managed 可写）、PRD §11.7
 * 及生产行为均矛盾——根因是 commit 86331a0 标签重命名时文案方向整体写反、门禁未动。
 * 后续改动请以门禁为准：**managed=本页可写，handwritten=本页只读**。
 *
 * ⚠ 2026-10-08 修订：模式选项旧称「我手写 / 平台管理」，实测被判歧义——「我手写」天然
 * 承诺"我在页面里写"，而实际含义是"平台别生成、我去高级区手写 YAML"，该层含义只写在
 * 二次确认弹窗里。用户选「我手写」后发现本页变只读，判为功能故障。措辞已与告警配置页
 * 对齐为「我来编辑 / 平台生成」，并在本页说明区与二次确认中**明说页面可编辑性**。
 * 底层枚举值（handwritten / managed）与门禁（isRouteEditable）不变。
 *
 * 解析失败时降级为原文只读展示（不白屏、不报错页）；平台生成模式下另给「部分导入 + 手动校正」通道。
 *
 * ⚠ 2026-10-08 修订：编辑态改为**首屏自动导入**（只读树加载完成即灌入），修掉
 * 「新建路由规则 / 保存并提交变更 按钮恒灰」的阻断缺陷——此前须先点「从当前配置导入」
 * 才进入编辑态，而该按钮在首屏更像可选动作而非前置步骤。
 */
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { EllipsisText } from '../../components/EllipsisText'
import { PageIntro } from '../../components/PageIntro'
import { MainLayout } from '../../layouts/MainLayout'
import {
  CONFIG_PREVIEW_PATH,
  NOTIFY_CHANNELS_PATH,
  ROUTE_MODE_HANDWRITTEN,
  ROUTE_MODE_MANAGED,
  ROUTE_MODE_TIP,
  ROUTE_ROOT_FALLBACK_TAG,
  ROUTE_SETTING_CARD_TITLE,
  ROUTE_SETTING_FALLBACK_LABEL,
  ROUTE_SETTING_MODE_INDEPENDENCE_TIP,
  ROUTE_SETTING_MODE_LABEL,
  formatMatchers,
} from './alertmanagerConstants'
import { isRouteEditable, useRouteEditor, useRoutes } from './useRoutes'
import { NONE_RECEIVER_VALUE, useRouteSetting } from './useRouteSetting'
import {
  blankRouteNode,
  canBeParent,
  countDescendants,
  nextRouteId,
  ROUTE_ROOT_ID,
  type RouteEditNode,
} from './routeTree'
import { RouteEditorDrawer } from './RouteEditorDrawer'
import type { DeadReceiver, RouteMode, RouteMatcher } from '../../types/alertmanager'

const { Text } = Typography

/** 常驻顶部说明：顺序即优先级（PRD §11.7） */
const ROUTE_ORDER_TIP = '路由顺序 = 生效顺序：先匹配到的先生效'

/**
 * 模式徽标文案（T08-F12）。
 *
 * ⚠ 措辞与下方 Segmented 选项**必须一致**（同一个 mode 的两种表述，故共用同一套常量）：
 * 「平台生成」= 平台产出路由、本页可编辑；「我来编辑」= 用户自己手写整份配置、本页只读。
 * 2026-10-08 修订前此处用「手写接管 / 平台管理」，与配置页选项「我手写 / 平台管理」对不上，
 * 且「接管」暗示冲突（实为二选一），故一并对齐为同一套词。
 */
const ROUTE_MODE_LABEL: Record<RouteMode, string> = {
  handwritten: ROUTE_MODE_HANDWRITTEN,
  managed: ROUTE_MODE_MANAGED,
}

/** 模式徽标配色：可编辑（managed）=处理中（蓝）；只读（handwritten）=中性（2026-10-13 随方向修正对调） */
const ROUTE_MODE_COLOR: Record<RouteMode, string> = {
  handwritten: 'default',
  managed: 'processing',
}

/** 顶层路由锁定说明（Tooltip）。去技术化：不说「route: 本体」，用户语言只说「顶层路由」。 */
const ROUTE_ROOT_LOCK_TIP = '顶层路由（兜底，即最外层的路由入口），不可删除、不可移动'

/** 顶层路由在父路由下拉中的展示名 */
const ROUTE_ROOT_PARENT_LABEL = '顶层路由（兜底）'

/** 路由名称展示：无注释名不造值——顶层路由显式化，子路由标注未命名 */
function routeDisplayName(name: string, locked: boolean): string {
  const trimmed = (name ?? '').trim()
  if (trimmed) return trimmed
  return locked ? '顶层路由' : '（未命名路由）'
}

/** 匹配条件展示串：空 = 兜底（匹配所有告警），复用静默页同款 matcher 格式化 */
function routeMatchersText(matchers: RouteMatcher[]): string {
  if (!matchers || matchers.length === 0) return '（匹配所有告警，兜底）'
  return formatMatchers(matchers)
}

/** 列表行视图（只读 RouteNode 与编辑态 RouteEditNode 归一，共用一套列渲染） */
interface RouteViewRow {
  id: string
  depth: number
  name: string
  matchers: RouteMatcher[]
  receiver: string
  group_by: string[]
  group_wait: string
  group_interval: string
  repeat_interval: string
  continue: boolean
  enabled: boolean
  /** 顶层路由（不可删、不可移） */
  locked: boolean
}

const YAML_BLOCK_STYLE = {
  margin: '12px 0 0',
  overflow: 'auto',
  maxHeight: 480,
  background: 'rgba(0, 0, 0, 0.02)',
  padding: 12,
  borderRadius: 8,
  fontSize: 13,
} as const

export function RoutesPage() {
  const { data, rows, loading, error, ready, reload } = useRoutes()
  const { modal, message } = App.useApp()
  // 路由设置（兜底渠道 + 模式）：原挂告警配置页，2026-10-13 按提案迁入本页常驻卡。
  const {
    setting: routeSetting,
    options: routeOptions,
    loading: routeLoading,
    error: routeError,
    saving: routeSaving,
    reload: reloadRouteSetting,
    save: saveRouteSetting,
  } = useRouteSetting()
  // 模式以 `useRouteSetting` 为准（保存后即刻生效，无需等只读树重新拉取）；
  // 该接口未回前退回只读树携带的 mode —— 两个来源同源于后端 route-setting。
  const mode: RouteMode = routeSetting?.mode ?? data?.mode ?? 'handwritten'
  const parseError = (data?.parse_error ?? '').trim()
  const degraded = parseError.length > 0
  const deadReceivers: DeadReceiver[] = data?.dead_receivers ?? []
  const editable = isRouteEditable(mode)

  /**
   * 没匹配到具体规则的告警发给谁（T08-F8 / 决策 113 口径 C）。
   * 护栏①：选定某个渠道 = 授权平台接管兜底，必须先经二次确认，文案明示注入点（只替换根 receiver 单键）。
   * 护栏③：选「不接管」= 停止替换、不删最后写入的值——无阻断交互，保存后明示结果。
   */
  const handleFallbackChange = (value: number) => {
    const saved = routeSetting?.default_receiver_channel_id ?? NONE_RECEIVER_VALUE
    if (value === saved) return
    if (value === NONE_RECEIVER_VALUE) {
      void saveRouteSetting(null)
        .then(() => message.success('已停止由平台指定这条兜底接收人；最后写入的值保留在配置文件中，可随时手改'))
        .catch((e) => message.error(e instanceof Error ? e.message : '保存失败，请稍后重试'))
      return
    }
    // 确认弹窗与结论 Tag 同理（2026-10-08）：**展示渠道名**，不展示平台内部接收人名
    // （`notify-1` 对用户判断"选了哪个渠道"无帮助，反而像技术串）。
    const targetName = routeOptions.find((o) => o.value === value)?.label ?? String(value)
    modal.confirm({
      title: '确认由平台接管这类告警？',
      content:
        `平台将在每次生成配置时，把「没有匹配到任何具体规则的告警」统一发往「${targetName}」；` +
        '你写的具体分流规则不受影响（它们优先于这一项）。' +
        '平台只替换这一个值：不触碰 group_by / group_wait / group_interval / repeat_interval / continue，也不写入具体分流规则。',
      okText: '确认指定',
      cancelText: '取消',
      onOk: async () => {
        try {
          await saveRouteSetting(value)
          message.success(`已选定：这类告警发往「${targetName}」`)
        } catch (e) {
          message.error(e instanceof Error ? e.message : '保存失败，请稍后重试')
        }
      },
    })
  }

  /**
   * 路由规则由谁维护（T08-F12）：handwritten（我来编辑）/ managed（平台生成）。
   * 护栏 §11.6：切到 handwritten 不会删除已生成的路由内容，仅改变后续生成归属（平台不再覆盖）。
   * 二次确认文案**明说页面可编辑性**，方向以门禁 `isRouteEditable` 为准：managed 可写、handwritten 只读。
   *
   * ⚠ 决策二 + 决策三（2026-10-13）：切到「我来编辑」时兜底**自动置「不接管」**
   * （后端 `materializeRootRouteReceiver` 不判 mode，手写模式下平台仍会替换根接收人），
   * 且该伴随声明必须与模式**合并进同一次 `PUT route-setting`** —— 拆成两次请求会产生
   * 用户未主动发起的独立变更单，违反决策 42-1。切回「平台生成」**不自动接管**（决策四）。
   */
  const handleModeChange = (next: RouteMode) => {
    if (next === mode) return
    const toManaged = next === 'managed'
    const currentChannelId = routeSetting?.default_receiver_channel_id ?? null
    const currentChannelName = currentChannelId
      ? (routeOptions.find((o) => o.value === currentChannelId)?.label ?? String(currentChannelId))
      : null
    // 决策二：仅在切到手写且当前确有接管渠道时才伴随置「不接管」；
    // 已是「不接管」时不再重复声明，避免变更单出现无意义的同值项。
    const releaseFallback = !toManaged && currentChannelId !== null
    modal.confirm({
      title: toManaged ? `切换为「${ROUTE_MODE_MANAGED}」？` : `切换为「${ROUTE_MODE_HANDWRITTEN}」？`,
      content: toManaged
        ? '切换后，路由规则由平台产出：你可在「路由规则」页直接增删改路由、保存提交变更，平台按页面改动生成整份配置。' +
          '注意：此后你在配置文件里手写的分流规则会被平台生成内容覆盖。'
        : '切换后，路由规则页变为只读视图，你在告警配置页的「导入整份配置文件」里手写整份配置。' +
          `注意：切换不会删除已生成的路由内容，只改变后续产出归属。${
            releaseFallback
              ? `平台将不再接管顶层路由的兜底接收人（当前：${currentChannelName} → 不接管），你的整份配置会被原样保留。`
              : '平台当前未接管顶层路由的兜底接收人，保持不变。'
          }`,
      okText: '确认切换',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 决策三：合并为**同一次** PUT（mode + default_receiver_channel_id），不发第二个请求。
          await saveRouteSetting(releaseFallback ? null : currentChannelId, next)
          message.success(
            toManaged
              ? `已切换为「${ROUTE_MODE_MANAGED}」：可在路由规则页直接编辑`
              : `已切换为「${ROUTE_MODE_HANDWRITTEN}」：本页转为只读（已生成内容保留）`,
          )
        } catch (e) {
          message.error(e instanceof Error ? e.message : '保存失败，请稍后重试')
        }
      },
    })
  }

  /**
   * 兜底控件行的状态结论（并入控件行）。
   *
   * ⚠️ **不得在此复述渠道名**（2026-10-08 用户实测）：结论与下拉框是**并列的两个独立元素**，
   * 若结论里再写一遍渠道名，界面上没有任何一处明说"二者是同一个"，用户被迫做连线题。
   * 故结论**只说状态**、用「你选中的渠道」回指控件。
   *
   * 同理严格区分「已生效」与「建议」：`enabled=true` 才称"已接管"，否则说"未接管"并把
   * `effective_receiver_name` 标为建议值（§11.9 契约）。
   */
  const fallbackConclusion = useMemo(() => {
    if (!routeSetting) return null
    if (routeSetting.effective_source === 'none') {
      return { tone: 'none' as const, text: '当前无可用渠道，平台不接管' }
    }
    if (routeSetting.enabled) {
      return { tone: 'on' as const, text: '已接管：这类告警发往你选中的渠道' }
    }
    return {
      tone: 'off' as const,
      text: `未接管${routeSetting.effective_receiver_name ? '（已启用渠道里的第一个是建议值，选定后生效）' : ''}`,
    }
  }, [routeSetting])

  /**
   * 两个开关的**关系**结论（原告警配置页 `policySummary`）。
   * 视觉隐藏：关系属"读卡要懂的关系"而非"当前状态"，与两个控件各自的结论争抢注意力。
   * 改为 screen-reader only，读屏用户与自动化测试仍能拿到这段关键事实。
   */
  const settingSummary = useMemo(() => {
    const managed = mode === 'managed'
    const routePart = managed ? '路由规则由平台生成' : '路由规则由你来编辑'
    if (!routeSetting) return `${routePart}；正在读取设定…`
    if (routeSetting.effective_source === 'none') {
      return `${routePart}；未匹配任何规则的告警暂未指定接收人，平台不接管。`
    }
    const receiver = routeSetting.effective_receiver_name
    if (!routeSetting.enabled) {
      return `${routePart}；未匹配任何规则的告警**未指定**接收人，平台未接管。${receiver} 只是建议值，选定后才会生效。`
    }
    const source = routeSetting.effective_source === 'explicit' ? '你指定的' : '已启用渠道的第一个'
    return `${routePart}；未匹配任何规则的告警发往 ${receiver}（${source}，平台已接管）。`
  }, [mode, routeSetting])

  /**
   * 「重新载入」二次确认：丢弃当前未保存的编辑属破坏性操作，不做静默覆盖。
   * 首屏已进入编辑态（自动导入），故此按钮几乎总是「有未保存改动」的状态，
   * 缺了确认就是一次无声的编辑丢失。
   */
  const confirmReload = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        modal.confirm({
          title: '重新载入当前配置？',
          content: '将丢弃你尚未保存的路由改动，并恢复为当前生效配置的路由内容。',
          okText: '确认重新载入',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      }),
    [modal],
  )

  /**
   * 部分导入（importState === 'partial'）保存护栏（H4）：覆盖式合入会改写原 route 段，
   * 保存前弹出二次确认 / 差异提示，确认后才真正提交；默认非破坏性（取消即中止）。
   * 声明于 `useRouteEditor` 调用之前，避免 TDZ（const 在声明前被引用导致 tsc 报错）。
   */
  const confirmPartialImport = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        modal.confirm({
          title: '确认保存部分导入的路由？',
          content:
            '当前为「部分导入」：仅包含你手动补齐的路由，保存将以覆盖方式合入当前生效配置，' +
            '可能改写原有 route 段中未被本次导入覆盖的部分。确认继续？',
          okText: '确认保存',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      }),
    [modal],
  )

  const editor = useRouteEditor({
    sourceItems: data?.items,
    parseError,
    rawYAML: data?.raw_yaml ?? '',
    // 首屏只读树加载完成即自动进入编辑态（2026-10-08）：修掉「新建/保存按钮恒灰」阻断。
    ready,
    declaredReceivers: data?.declared_receivers,
    onSaved: reload,
    confirmPartialImport,
    confirmReload,
  })
  const editing = editor.importState !== 'empty'
  /** 解析失败时先只给原文；平台模式下导入（部分导入）后仍需渲染编辑树供手动校正 */
  const showTree = !degraded || (editable && editing)

  /** 已知接收人集合（H1/H2 共用）：已启用渠道物化的 AM receiver 名，用于悬空校验与「未定义」渲染 */
  const knownReceiverSet = useMemo(() => new Set(editor.knownReceivers), [editor.knownReceivers])
  /** 平台物化 receiver → 渠道中文名：列表 / 抽屉把 `notify-N` 显示成用户认识的渠道名 */
  const receiverChannelNames = editor.receiverChannelNames

  const [editingNode, setEditingNode] = useState<RouteEditNode | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /** 列表数据源：平台模式且已导入 → 编辑态树；否则只读树 */
  const viewRows: RouteViewRow[] = useMemo(() => {
    if (editable && editing) {
      return editor.rows.map((r) => ({
        id: r.node.id,
        depth: r.depth,
        name: r.node.name,
        matchers: r.node.matchers,
        receiver: r.node.receiver,
        group_by: r.node.group_by,
        group_wait: r.node.group_wait,
        group_interval: r.node.group_interval,
        repeat_interval: r.node.repeat_interval,
        continue: r.node.continue,
        enabled: r.node.enabled,
        locked: r.node.parent_id === '',
      }))
    }
    return rows.map((r) => ({
      id: r.node.id,
      depth: r.depth,
      name: r.node.name,
      matchers: r.node.matchers,
      receiver: r.node.receiver,
      group_by: r.node.group_by,
      group_wait: r.node.group_wait,
      group_interval: r.node.group_interval,
      repeat_interval: r.node.repeat_interval,
      continue: r.node.continue,
      enabled: true,
      locked: r.node.locked,
    }))
  }, [editable, editing, editor.rows, rows])

  const openEditor = useCallback(
    (id: string) => {
      const node = editor.tree.find((n) => n.id === id)
      if (!node) return
      setEditingNode(node)
      setDrawerOpen(true)
    },
    [editor],
  )

  function openCreate() {
    const parentId = editor.tree.length > 0 ? ROUTE_ROOT_ID : ''
    setEditingNode(blankRouteNode('', parentId))
    setDrawerOpen(true)
  }

  const confirmDelete = useCallback(
    (id: string) => {
      const node = editor.tree.find((n) => n.id === id)
      if (!node || node.parent_id === '') return
      const children = countDescendants(editor.tree, id)
      const label = node.name.trim() || id
      modal.confirm({
        title: `删除路由「${label}」？`,
        content:
          children > 0
            ? `将同时删除 ${children} 条子路由：该路由下还有 ${children} 条子路由，一并删除后不可恢复。删除后需保存并提交变更单才会生效。`
            : '删除后需保存并提交变更单才会生效。',
        okText: children > 0 ? `同时删除 ${children} 条子路由` : '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => editor.remove(id),
      })
    },
    [editor, modal],
  )

  function handleSubmit(node: RouteEditNode) {
    const withId: RouteEditNode = node.id
      ? node
      : { ...node, id: nextRouteId(editor.tree, node.parent_id) }
    editor.upsert(withId)
    setDrawerOpen(false)
  }

  const columns: ColumnsType<RouteViewRow> = useMemo(() => {
    const base: ColumnsType<RouteViewRow> = [
      {
        title: '路由名称',
        key: 'name',
        render: (_: unknown, row: RouteViewRow) => (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: row.depth * 20 }}
          >
            {row.depth > 0 && (
              <span style={{ fontFamily: 'monospace', color: 'rgba(0, 0, 0, 0.25)' }}>└─</span>
            )}
            {row.locked && (
              <Tooltip title={ROUTE_ROOT_LOCK_TIP}>
                <LockOutlined data-testid="route-root-lock" />
              </Tooltip>
            )}
            <EllipsisText strong={row.locked} maxWidth={220}>
              {routeDisplayName(row.name, row.locked)}
            </EllipsisText>
            {row.locked && <Tag color="blue">顶层</Tag>}
            {/* 顶层路由的接收人由上方「路由设置」决定（决策一 / §4.2），本页不可直接改。
                行内明写，避免用户盯着这一行反复找「接收人」下拉。 */}
            {row.locked && editable && (
              <Tag color="default" data-testid="route-root-fallback-tag">
                {ROUTE_ROOT_FALLBACK_TAG}
              </Tag>
            )}
          </span>
        ),
      },
      {
        title: '匹配条件',
        key: 'matchers',
        render: (_: unknown, row: RouteViewRow) => (
          <EllipsisText code maxWidth={260}>
            {routeMatchersText(row.matchers)}
          </EllipsisText>
        ),
      },
      {
        title: '接收人',
        key: 'receiver',
        render: (_: unknown, row: RouteViewRow) => {
          if (!row.receiver) return <Text type="secondary">-</Text>
          // H2：引用了未定义的接收人（不在已知接收人集合内）→ 红色「未定义」显式告警，
          // 直观提示该路由的告警将无处可发（避免默默渲染成空白 / 普通值）。
          if (knownReceiverSet.size > 0 && !knownReceiverSet.has(row.receiver)) {
            return (
              <Tooltip title={`接收人「${row.receiver}」未在已启用通知渠道 / 当前配置中定义，告警将无处可发`}>
                <Text type="danger" data-testid="route-receiver-undefined">
                  未定义
                </Text>
              </Tooltip>
            )
          }
          // 平台物化的 receiver（notify-N）→ 显示成用户认识的渠道名 + 括号内配置名，
          // 解决「渠道叫『运维告警飞书群』、路由里却是 notify-1」的看不懂问题：
          // 渠道名含中文时无法直接作 AM receiver 名，平台按规则清洗后回落 `notify-N`。
          const channelName = receiverChannelNames[row.receiver]
          if (channelName) {
            return (
              <Tooltip
                title={`来自平台通知渠道「${channelName}」：渠道名无法直接作配置名，平台自动生成接收人「${row.receiver}」`}
              >
                <span data-testid="route-receiver-channel">
                  {channelName}（{row.receiver}）
                </span>
              </Tooltip>
            )
          }
          // 文件里手写声明、但不对应任何平台渠道的 receiver（如预置的 `feishu`）：
          // 按「已知接收人」正常展示（保存死锁修复口径），但标注来源避免与渠道 receiver 混淆。
          // 映射整体为空（渠道接口取数失败）时无法区分来源 → 不标注，避免把渠道 receiver 误标成手写。
          if (Object.keys(receiverChannelNames).length === 0) {
            return (
              <EllipsisText code maxWidth={180}>
                {row.receiver}
              </EllipsisText>
            )
          }
          return (
            <Tooltip title={`配置文件中手写的接收人「${row.receiver}」，不对应平台通知渠道`}>
              <span>
                <EllipsisText code maxWidth={180}>
                  {row.receiver}
                </EllipsisText>
                <Text type="secondary" style={{ marginLeft: 4, fontSize: 12 }}>
                  手写
                </Text>
              </span>
            </Tooltip>
          )
        },
      },
      {
        title: '分组键',
        key: 'group_by',
        render: (_: unknown, row: RouteViewRow) =>
          row.group_by.length > 0 ? (
            <EllipsisText maxWidth={200}>{row.group_by.join(', ')}</EllipsisText>
          ) : (
            <Text type="secondary">-</Text>
          ),
      },
      {
        title: '发送节奏',
        key: 'timing',
        render: (_: unknown, row: RouteViewRow) => (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.group_wait || '-'} / {row.group_interval || '-'} / {row.repeat_interval || '-'}
          </Text>
        ),
      },
      {
        title: '继续匹配',
        key: 'continue',
        width: 100,
        render: (_: unknown, row: RouteViewRow) =>
          row.continue ? <Tag color="processing">是</Tag> : <Tag>否</Tag>,
      },
      {
        title: '启用',
        key: 'enabled',
        width: 80,
        render: (_: unknown, row: RouteViewRow) =>
          row.enabled ? <Tag color="success">启用</Tag> : <Tag>停用</Tag>,
      },
    ]
    if (!editable || !editing) return base
    return [
      ...base,
      {
        title: '排序',
        key: 'order',
        width: 100,
        render: (_: unknown, row: RouteViewRow) => {
          if (row.locked) {
            return (
              <Tooltip title="顶层路由不可移动">
                <Text type="secondary" style={{ fontSize: 12 }}>
                  锁定
                </Text>
              </Tooltip>
            )
          }
          const siblings = editor.rows.filter((r) => r.node.parent_id === parentIdOf(editor.tree, row.id))
          const idx = siblings.findIndex((r) => r.node.id === row.id)
          return (
            <Space size={0}>
              <Tooltip title="上移（提高优先级）">
                <Button
                  type="text"
                  size="small"
                  aria-label={`上移 ${row.id}`}
                  icon={<ArrowUpOutlined />}
                  disabled={idx <= 0}
                  onClick={() => editor.move(row.id, -1)}
                />
              </Tooltip>
              <Tooltip title="下移（降低优先级）">
                <Button
                  type="text"
                  size="small"
                  aria-label={`下移 ${row.id}`}
                  icon={<ArrowDownOutlined />}
                  disabled={idx < 0 || idx >= siblings.length - 1}
                  onClick={() => editor.move(row.id, 1)}
                />
              </Tooltip>
            </Space>
          )
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 140,
        render: (_: unknown, row: RouteViewRow) => (
          <Space size={0}>
            <Button
              type="text"
              size="small"
              aria-label={`编辑 ${row.id}`}
              icon={<EditOutlined />}
              onClick={() => openEditor(row.id)}
            >
              编辑
            </Button>
            {!row.locked && (
              <Button
                type="text"
                size="small"
                danger
                aria-label={`删除 ${row.id}`}
                icon={<DeleteOutlined />}
                onClick={() => confirmDelete(row.id)}
              >
                删除
              </Button>
            )}
          </Space>
        ),
      },
    ]
  }, [editable, editing, editor, knownReceiverSet, receiverChannelNames, openEditor, confirmDelete])

  /** 父路由下拉：排除自身与其后代（避免成环） */
  const parentOptions = useMemo(() => {
    const currentId = editingNode?.id ?? ''
    return editor.tree
      .filter((n) => (currentId ? canBeParent(editor.tree, currentId, n.id) : true))
      .map((n) => ({
        value: n.id,
        label: n.parent_id === '' ? ROUTE_ROOT_PARENT_LABEL : n.name.trim() || n.id,
      }))
  }, [editor.tree, editingNode])

  /** 接收人下拉候选：已知渠道接收人 ∪ 树中已引用的接收人（F13 将改为渠道联动） */
  const receiverOptions = useMemo(() => {
    const names = new Set(editor.knownReceivers)
    for (const n of editor.tree) if (n.receiver.trim()) names.add(n.receiver.trim())
    return Array.from(names)
  }, [editor.knownReceivers, editor.tree])

  return (
    <MainLayout>
      {/* 页头 + 说明区（四页统一，见 components/PageIntro.tsx）。
          「顺序即优先级」与模式徽标是**随状态变化**的信息（换mode 就变），故留在页头下方常驻；
          说明区只放不随状态变化的机制说明（2026-10-13 去重：模式引导只留在常驻区，不再重复）。 */}
      <PageIntro
        testId="routes-intro"
        title="路由规则"
        // 2026-10-13（提案 §2.2）：副标改为同时兜住本页两件事——谁产出路由规则 + 没匹配到规则的告警发给谁
        // （原副标只讲「按标签匹配」，读不出上方那张「路由设置」卡也归本页管）。
        subtitle="维护告警路由：谁产出路由规则、没匹配到规则的告警发给谁"
        points={[
          // 2026-10-13 去重：只留**不随状态变化**的机制说明。「顺序即生效顺序」与模式引导
          // 已由下方常驻状态区承载（PRD §11.7 要求常驻），此前在说明区重复一遍且方向写反。
          '一条规则包含：匹配条件（发什么）、接收人（发给谁）、分组与节奏（怎么攒批、多久重发）。',
          '顶层路由是所有告警的总入口，不可删除、不可移动；它同时承载「未匹配任何规则的告警发给谁」。',
        ]}
      />

      {/* 路由设置常驻卡（2026-10-13，提案 alert-config-policy-split-migration.md §2.1）：
          原「路由与收敛策略」卡在告警配置页，与该页职责（当前生效 + 版本历史 + 导入）不符，
          且兜底控件与顶层路由分处两页——改一处、另一处被后端 `materializeRootRouteReceiver`
          静默覆盖（该函数不判 mode）。现两控件与顶层路由同屏同区，从根上消掉「两入口需手动同步」。 */}
      <Card
        title={ROUTE_SETTING_CARD_TITLE}
        style={{ marginBottom: 16 }}
        data-testid="route-setting-card"
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {/* 控件 B：没匹配到具体规则的告警发给谁（含「不接管」= 平台不替换顶层路由接收人）。
              与控件 A 同卡，避免用户在两页之间来回找这一个开关。 */}
          <div>
            <Space size={8} align="center" wrap>
              <Text strong>{ROUTE_SETTING_FALLBACK_LABEL}</Text>
              <Select<number>
                aria-label={ROUTE_SETTING_FALLBACK_LABEL}
                value={routeSetting?.default_receiver_channel_id ?? NONE_RECEIVER_VALUE}
                options={routeOptions}
                loading={routeLoading}
                disabled={routeLoading || routeSaving}
                style={{ minWidth: 320 }}
                onChange={handleFallbackChange}
              />
              {fallbackConclusion && (
                <Tag
                  color={fallbackConclusion.tone === 'on' ? 'success' : 'default'}
                  data-testid="fallback-conclusion"
                >
                  {fallbackConclusion.text}
                </Tag>
              )}
            </Space>
            {/* 决策五原句常驻落位：手写整份文件 ≠ 交出兜底。不明写会被理解成
                「切到手写 = 交出全部控制权」，而只有这一项仍由平台决定。 */}
            <Text
              type="secondary"
              style={{ display: 'block', marginTop: 4, fontSize: 12 }}
              data-testid="route-setting-independence-tip"
            >
              {ROUTE_SETTING_MODE_INDEPENDENCE_TIP}
            </Text>
          </div>

          {/* 控件 A：路由规则由谁维护（Segmented 表达二选一模式，非 Switch 的开/关）。
              置于控件 B 之下，让"读卡顺序 = 因果顺序"：先看清兜底归谁，再决定谁来写路由。 */}
          <div>
            <Space size={8} align="center" wrap>
              <Text strong>{ROUTE_SETTING_MODE_LABEL}</Text>
              <Segmented
                aria-label={ROUTE_SETTING_MODE_LABEL}
                value={mode === 'managed' ? 'managed' : 'handwritten'}
                disabled={routeLoading || routeSaving}
                options={[
                  { label: ROUTE_MODE_HANDWRITTEN, value: 'handwritten' },
                  { label: ROUTE_MODE_MANAGED, value: 'managed' },
                ]}
                onChange={(value) => handleModeChange(value as RouteMode)}
              />
            </Space>
            <Text
              type="secondary"
              style={{ display: 'block', marginTop: 4, fontSize: 12 }}
              data-testid="route-setting-mode-tip"
            >
              {ROUTE_MODE_TIP[mode]}
            </Text>
          </div>

          {routeError ? (
            <Text type="danger">
              设定加载失败：{routeError}{' '}
              <Button size="small" type="link" onClick={reloadRouteSetting}>
                重试
              </Button>
            </Text>
          ) : null}

          {/* 两个开关的**关系**结论（§6.3：手写模式下平台仍接管兜底单键）。
              视觉隐藏：属"读卡要懂的关系"而非"当前状态"，与两个控件各自的结论争抢注意力
              （2026-10-08 实测"信息量过大"的主因之一）。screen-reader only，读屏与测试仍可拿到。 */}
          <span
            data-testid="route-setting-summary"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {settingSummary}
          </span>
        </Space>
      </Card>

      {/* 常驻状态区：顺序即优先级 + 模式徽标（按 mode 渲染） */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          <Space size={8} wrap>
            <Text strong>{ROUTE_ORDER_TIP}</Text>
            <Tag color={ROUTE_MODE_COLOR[mode]} data-testid="route-mode-badge">
              {ROUTE_MODE_LABEL[mode]}
            </Tag>
          </Space>
        }
        description={
          // 2026-10-13 方向修正：此前两分支与门禁 `isRouteEditable`（managed=可写，PRD §11.7
          // L752「平台管理模式可写、手写模式只读」）写反，导致按钮明明可点却提示「本页为只读」。
          // A5：反向链接（原「前往告警配置」）已删除——模式开关已迁至上方常驻「路由设置」卡，
          // 让用户为改一个开关跨页跳转是纯粹的绕路；改为就地指引（指向本卡控件 A）。
          mode === 'handwritten' ? (
            <Text>
              本页为只读展示，不提供新建 / 编辑 / 拖拽入口；在上方
              <Text strong>「路由设置」</Text>
              里把「路由规则由谁维护」切换为「{ROUTE_MODE_MANAGED}」，即可在此页直接编辑。
            </Text>
          ) : (
            <Text>
              本页可直接新建 / 编辑 / 拖拽调整顺序，改动经「保存并提交变更」进入「配置变更确认」，不即时生效。
            </Text>
          )
        }
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="路由规则加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          }
        />
      ) : (
        <>
          {/* 解析失败降级：原文只读展示 + 提示（不白屏、不报错页）；
              平台模式下仍可从上方操作区「从当前配置导入」走「部分导入 + 手动校正」通道 */}
          {degraded && (
          <Card
            title={
              <Space size={8}>
                <WarningOutlined />
                路由配置解析失败，已降级为原文只读展示
              </Space>
            }
            style={{ marginBottom: 16 }}
          >
          <Alert
            type="warning"
            showIcon
            message="无法解析当前 alertmanager.yml 的 route 段"
            description={parseError}
          />
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
            为避免白屏，下面按原文只读展示当前 alertmanager.yml 内容；修复配置后可点击「重新加载」重试。
          </Text>
          <pre style={YAML_BLOCK_STYLE}>{data?.raw_yaml ?? ''}</pre>
            <Space style={{ marginTop: 12 }}>
              <Button size="small" onClick={reload}>
                重新加载
              </Button>
            </Space>
          </Card>
          )}

          {/* 孤立接收人（dev-feedback #26；2026-10-08 文案修订）：平台物化了接收人却无路由指向。
              原文案「平台已生成但没有任何路由指向」主语是「平台」，易被读成「平台内置了路由规则
              却没指向它」——实际是**用户的路由全指向了别的接收人**（多为手写），平台那条通道空着。
              新文案讲清这个区别，并明示「怎么消解」，避免用户无处下手。 */}
          {!degraded && deadReceivers.length > 0 && (
            <Card
              title={
                <Space size={8}>
                  <WarningOutlined />
                  有接收人没有路由指向它
                  <Tag color="warning">{deadReceivers.length}</Tag>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Text type="secondary">
                平台已为下列接收人生成了配置，但当前路由里没有任何一条规则指向它们——
                也就是说，<Text strong>这些接收人所属的渠道收不到告警</Text>。
                （若你看到路由都指向另一个手写的接收人，那说明告警正走你自己的通道，平台这条是备用的。）
              </Text>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                {deadReceivers.map((d) => (
                  <li key={d.name} style={{ marginBottom: 4 }}>
                    <Text code>{d.name}</Text>
                    <Text type="secondary"> — {d.url}</Text>
                  </li>
                ))}
              </ul>
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
                <Text strong>两种处理方式</Text>：
                <br />
                ① 想用它发告警 → 在上方新建或编辑一条规则，把「接收人」选成它，然后保存提交变更。
                <br />
                ② 暂不用它 →
                <Link to={NOTIFY_CHANNELS_PATH} data-testid="dead-receiver-channels-link">
                  {' '}
                  前往「通知渠道」页
                </Link>
                停用或删除对应渠道，平台就不会再生成这个接收人。
              </Text>
            </Card>
          )}

          {editable && (
            <Card style={{ marginBottom: 16 }} styles={{ body: { paddingBlock: 12 } }}>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={openCreate}
                  disabled={!editing}
                  data-testid="route-new-btn"
                >
                  新建路由规则
                </Button>
                <Button onClick={editor.importFromCurrent} data-testid="route-import-btn">
                  {editing ? '重新载入' : '从当前配置导入'}
                </Button>
                <Button
                  type="primary"
                  onClick={() => void editor.save()}
                  loading={editor.saving}
                  disabled={!editing}
                  data-testid="route-save-btn"
                >
                  保存并提交变更
                </Button>
                {editing && (
                  <Button onClick={editor.reset} data-testid="route-reset-btn">
                    放弃编辑
                  </Button>
                )}
              </Space>
              {/* 2026-10-13 布局优化：导入成功提示从卡片外的整条绿色 Alert 收进操作区内
                  （紧挨其指引的「保存并提交变更」按钮）。整条大绿条会把保存按钮挤出首要视线，
                  且 message 与 description 重复「已从当前配置导入」。partial（warning）信息量大，
                  仍保留下方独立 Alert。 */}
              {editor.importState === 'imported' && editor.importNotice && (
                <Text
                  type="success"
                  style={{ display: 'block', marginTop: 8, fontSize: 12 }}
                  data-testid="route-import-notice"
                >
                  {editor.importNotice}
                </Text>
              )}
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                {editing
                  ? '保存会生成整份 alertmanager.yml 并提交挂载；改动不会立即生效，需在「配置变更确认」中人工确认后才会写入并 reload。'
                  : degraded
                    ? '当前配置无法完整解析，尚未进入编辑态。点「从当前配置导入」可按空白根路由开始手动补齐。'
                    : '正在加载当前路由配置，加载完成后即可直接编辑。'}
              </Text>
            </Card>
          )}

          {/* 部分导入提示（不可无损导入，需手动校正）——完整导入的成功提示已收进上方操作区 */}
          {editable && editor.importState === 'partial' && editor.importNotice && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              data-testid="route-import-notice"
              message="部分导入：不可无损导入，请手动校正"
              description={editor.importNotice}
            />
          )}

          {/* 保存结果 */}
          {editor.saveResult && (
            <Alert
              type={editor.saveResult.ok ? 'success' : 'error'}
              showIcon
              style={{ marginBottom: 16 }}
              data-testid="route-save-result"
              message={editor.saveResult.ok ? '已提交，等待你在「配置变更确认」中确认下发' : '保存未通过'}
              description={
                editor.saveResult.ok ? (
                  <Space direction="vertical" size={4}>
                    <span>{editor.saveResult.message}</span>
                    {/* 成功后的唯一下一步就是去 M09 确认（提交只产 pending 草稿，不即时生效）。 */}
                    <Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>
                  </Space>
                ) : (
                  editor.saveResult.message
                )
              }
            />
          )}

          {/* 保存前本地预检：阻断项红字列出（不阻断保存按钮交互，保存时再次裁决） */}
          {editable && editor.blocking.length > 0 && (
            <div data-testid="route-precheck-blocking">
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
                message={`保存前预检未通过（${editor.blocking.length} 项，必须修正后才能保存）`}
                description={
                  <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                    {editor.blocking.map((i, idx) => (
                      <li key={idx}>{i.message}</li>
                    ))}
                  </ul>
                }
              />
            </div>
          )}
          {editable && editor.warnings.length > 0 && (
            <div data-testid="route-precheck-warning">
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message={`可以保存，但有 ${editor.warnings.length} 项建议确认`}
                description={
                  <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
                    {editor.warnings.map((i, idx) => (
                      <li key={idx}>{i.message}</li>
                    ))}
                  </ul>
                }
              />
            </div>
          )}

          {showTree && (
          <Card
            title={
              <Space size={8}>
                路由树
                {editable ? <Tag color="processing">可编辑</Tag> : <Tag>只读</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {viewRows.length} 个节点
                </Text>
              </Space>
            }
          >
            <Table<RouteViewRow>
              rowKey={(row) => row.id}
              dataSource={viewRows}
              columns={columns}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty description="当前无生效配置，或 route 段为空" /> }}
              onRow={(row) => {
                const draggable = editable && editing && !row.locked
                return {
                  draggable,
                  style: draggingId === row.id ? { background: 'rgba(0, 0, 0, 0.04)' } : undefined,
                  onDragStart: () => draggable && setDraggingId(row.id),
                  onDragOver: (e) => {
                    if (draggable) e.preventDefault()
                  },
                  onDrop: (e) => {
                    e.preventDefault()
                    if (draggingId && draggingId !== row.id) editor.reorder(draggingId, row.id)
                    setDraggingId(null)
                  },
                  onDragEnd: () => setDraggingId(null),
                }
              }}
            />
          </Card>
          )}
        </>
      )}

      {/* 手写模式下本页整体只读：不挂载编辑抽屉（forceRender 会常驻渲染表单，故按模式条件挂载） */}
      {editable && (
        <RouteEditorDrawer
          open={drawerOpen}
          node={editingNode}
          parentOptions={parentOptions}
          receiverOptions={receiverOptions}
          knownReceivers={editor.knownReceivers}
          receiverChannelNames={receiverChannelNames}
          issues={editor.issues}
          onClose={() => setDrawerOpen(false)}
          onSubmit={handleSubmit}
        />
      )}
    </MainLayout>
  )
}

/** 取节点父 ID（供同级排序定位；找不到返回空串） */
function parentIdOf(tree: RouteEditNode[], id: string): string {
  return tree.find((n) => n.id === id)?.parent_id ?? ''
}
