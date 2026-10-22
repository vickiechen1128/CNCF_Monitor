/**
 * 「路由规则」页（T08-F10 只读路由树 + T08-F11 三段式表单编辑）。
 *
 * 契约：Module_08 §11.7（列表态 / 编辑态）/ §9.1；task-sequence T08-F10 / T08-F11。
 * 数据：`GET /api/v2/platform/alertmanager/routes`（T08-12，仅全局认证、只读无写能力）。
 *
 * 2026-10-22 用户裁决：**路由树是告警路由的唯一配置入口**。
 *   - 删除「路由规则由谁维护」模式开关与「根兜底接管」控件；
 *   - 本页始终可写：新建 / 编辑 / 删除 / 上移下移 / 拖拽 / 保存并提交变更；
 *   - 顶层路由的接收人同样在本页直接编辑（不再由平台兜底设定覆盖）；
 *   - 保存 = 生成整份 alertmanager.yml → 复用既有
 *     `POST /api/v2/platform/alertmanager/config`（**零新增端点**）→ 触发 M09 变更单，
 *     **不即时生效**。
 *
 * 解析失败时降级为原文只读展示（不白屏、不报错页），并给「部分导入 + 手动校正」通道。
 *
 * ⚠ 2026-10-08 修订：编辑态改为**首屏自动导入**（只读树加载完成即灌入），修掉
 * 「新建路由规则 / 保存并提交变更 按钮恒灰」的阻断缺陷——此前须先点「从当前配置导入」
 * 才进入编辑态，而该按钮在首屏更像可选动作而非前置步骤。
 */
import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
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
  DEFAULT_RECEIVER_LABEL,
  NOTIFY_CHANNELS_PATH,
  formatMatchers,
} from './alertmanagerConstants'
import { useRouteEditor, useRoutes } from './useRoutes'
import {
  blankRouteNode,
  canBeParent,
  countDescendants,
  DEFAULT_RECEIVER_NAME,
  nextRouteId,
  ROUTE_ROOT_ID,
  type RouteEditNode,
} from './routeTree'
import { RouteEditorDrawer } from './RouteEditorDrawer'
import type { DeadReceiver, RouteMatcher } from '../../types/alertmanager'

const { Text } = Typography

/** 常驻顶部说明：顺序即优先级（PRD §11.7） */
const ROUTE_ORDER_TIP = '路由顺序 = 生效顺序：先匹配到的先生效'

/** 顶层路由锁定说明（Tooltip）。去技术化：不说「route: 本体」，用户语言只说「顶层路由」。 */
const ROUTE_ROOT_LOCK_TIP = '顶层路由（兜底，即最外层的路由入口），不可删除、不可移动'

/** 路由树读表须知（表格上方常驻）。
 *  2026-10-14：原在 PageIntro 折叠要点里，与「一条规则包含什么」挤在同一折叠区，
 *  而它约束的是**这张表**（哪一行是总入口、哪一行不能动），故下沉到表格正上方常驻。 */
const ROUTE_TREE_LEAD_IN = '顶层路由是所有告警的总入口（兜底），不可删除、不可移动。'

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

/** 「需要处理」卡内单条提示的严重度：error = 阻断保存，warning = 可保存但建议确认，
 *  success = 已提交待人工确认。 */
type RouteNoticeLevel = 'error' | 'warning' | 'success'

interface RouteNotice {
  key: string
  level: RouteNoticeLevel
  /** 沿用各自原有 data-testid，避免收敛后破坏既有测试契约 */
  testId?: string
  title: string
  body?: ReactNode
}

/** 严重度排序权重（error 最先，success 最后） */
const NOTICE_LEVEL_ORDER: Record<RouteNoticeLevel, number> = { error: 0, warning: 1, success: 2 }
const NOTICE_LEVEL_COLOR: Record<RouteNoticeLevel, string> = {
  error: 'error',
  warning: 'warning',
  success: 'success',
}

export function RoutesPage() {
  const { data, rows, loading, error, effectiveChecksum, pending, reload } = useRoutes()
  const { modal } = App.useApp()
  const parseError = (data?.parse_error ?? '').trim()
  const degraded = parseError.length > 0
  const deadReceivers: DeadReceiver[] = data?.dead_receivers ?? []
  /**
   * 配置不完整（importState === 'partial'）时的保存护栏（H4）：覆盖式合入会改写原 route 段，
   * 保存前弹出二次确认，确认后才真正提交；默认非破坏性（取消即中止）。
   * 声明于 `useRouteEditor` 调用之前，避免 TDZ（const 在声明前被引用导致 tsc 报错）。
   */
  const confirmPartialImport = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        modal.confirm({
          title: '确认保存当前路由？',
          content:
            '当前配置无法完整解析，编辑区从空白路由树开始。保存将以覆盖方式合入当前生效配置，' +
            '可能改写原有 route 段中未被本次编辑覆盖的部分。确认继续？',
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
    baseChecksum: effectiveChecksum,
    onSaved: reload,
    confirmPartialImport,
  })
  const editing = editor.importState !== 'empty'
  /** 解析失败时先只给原文；进入编辑态后仍渲染空白编辑树供手动校正 */
  const showTree = !degraded || editing

  /** 点「编辑路由」时先刷新一次服务端配置，再灌入编辑区（避免用旧页面覆盖新配置） */
  const [enteringEdit, setEnteringEdit] = useState(false)
  /** 保存成功后回到只读态，并常驻提示「已提交、待确认下发」 */
  const [submitted, setSubmitted] = useState(false)
  const { importFromCurrent } = editor

  const enterEdit = useCallback(() => {
    setSubmitted(false)
    setEnteringEdit(true)
    // 先刷新服务端配置，加载完成后再把本次最新树载入编辑区
    // （直接使用回调回传的 fresh 数据，避免拿到刷新前闭包里的旧 sourceItems）。
    reload((ok, fresh) => {
      setEnteringEdit(false)
      if (!ok) return
      importFromCurrent(fresh?.items, (fresh?.parse_error ?? '').trim())
    })
  }, [reload, importFromCurrent])

  /** 保存成功后回到只读态（后续生效由 M09 确认下发） */
  const handleSave = useCallback(async () => {
    const ok = await editor.save()
    if (!ok) return
    setSubmitted(true)
    editor.reset()
  }, [editor])

  /** 放弃编辑：有未保存改动时二次确认；未改动直接退出，不打扰用户 */
  const handleDiscard = useCallback(() => {
    if (!editor.dirty) {
      editor.reset()
      setSubmitted(false)
      reload()
      return
    }
    modal.confirm({
      title: '放弃本次编辑？',
      content: '将丢弃你尚未保存的路由改动；当前生效配置不受影响。',
      okText: '放弃编辑',
      okButtonProps: { danger: true },
      cancelText: '继续编辑',
      onOk: () => {
        editor.reset()
        setSubmitted(false)
        reload()
      },
    })
  }, [editor, modal, reload])

  /** 已知接收人集合（H1/H2 共用）：已启用渠道物化的 AM receiver 名，用于悬空校验与「未定义」渲染 */
  const knownReceiverSet = useMemo(() => new Set(editor.knownReceivers), [editor.knownReceivers])
  /** 平台物化 receiver → 渠道中文名：列表 / 抽屉把 `notify-N` 显示成用户认识的渠道名 */
  const receiverChannelNames = editor.receiverChannelNames

  const [editingNode, setEditingNode] = useState<RouteEditNode | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /** 列表数据源：编辑态树；只读态直接渲染服务端配置（默认配置已由后端 seed 落库） */
  const viewRows: RouteViewRow[] = useMemo(() => {
    if (editing) {
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
  }, [editing, editor.rows, rows])

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

  /**
   * 接收人单元格渲染。抽出为具名函数以便与「设定 ≠ 已生效」的行内标注组合
   * （原为 76 行内联 render，包在 columns 的 useMemo 里无法再加旁注）。
   *
   * 三类展示：渠道 receiver（中文渠道名 + 配置名）/ 未定义（红字告警）/ 手写（标注来源）。
   */
  const renderReceiverCell = useCallback(
    (receiver: string): ReactNode => {
      if (!receiver) return <Text type="secondary">-</Text>
      // 平台内置空接收人：明确标注「不通知」，避免被误认为某个真实渠道。
      if (receiver === DEFAULT_RECEIVER_NAME) {
        return (
          <Tooltip title="命中的告警不会发送到任何通知渠道（静默丢弃）">
            <Tag data-testid="route-receiver-default">{DEFAULT_RECEIVER_LABEL}</Tag>
          </Tooltip>
        )
      }
      // H2：引用了未定义的接收人（不在已知接收人集合内）→ 红色「未定义」显式告警，
      // 直观提示该路由的告警将无处可发（避免默默渲染成空白 / 普通值）。
      if (knownReceiverSet.size > 0 && !knownReceiverSet.has(receiver)) {
        return (
          <Tooltip title={`接收人「${receiver}」未在已启用通知渠道 / 当前配置中定义，告警将无处可发`}>
            <Text type="danger" data-testid="route-receiver-undefined">
              未定义
            </Text>
          </Tooltip>
        )
      }
      // 平台物化的 receiver（notify-N）→ 显示成用户认识的渠道名 + 括号内配置名，
      // 解决「渠道叫『运维告警飞书群』、路由里却是 notify-1」的看不懂问题：
      // 渠道名含中文时无法直接作 AM receiver 名，平台按规则清洗后回落 `notify-N`。
      const channelName = receiverChannelNames[receiver]
      if (channelName) {
        return (
          <Tooltip
            title={`来自平台通知渠道「${channelName}」：渠道名无法直接作配置名，平台自动生成接收人「${receiver}」`}
          >
            <span data-testid="route-receiver-channel">
              {channelName}（{receiver}）
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
            {receiver}
          </EllipsisText>
        )
      }
      return (
        <Tooltip title={`配置文件中手写的接收人「${receiver}」，不对应平台通知渠道`}>
          <span>
            <EllipsisText code maxWidth={180}>
              {receiver}
            </EllipsisText>
            <Text type="secondary" style={{ marginLeft: 4, fontSize: 12 }}>
              手写
            </Text>
          </span>
        </Tooltip>
      )
    },
    [knownReceiverSet, receiverChannelNames],
  )

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
        render: (_: unknown, row: RouteViewRow) => (
          <span>
            {renderReceiverCell(row.receiver)}
            {/* 「设定 ≠ 已生效」的行内灰字标注（2026-10-14）：只在顶层路由行出现——只有它的
                receiver 由平台兜底控件决定，才有落差。刻意用灰字而非醒目色：它是「当前事实」
                的陈述，不是需要动作的告警；真正需要动作的横幅在兜底控件正下方。 */}
          </span>
        ),
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
    if (!editing) return base
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
  }, [editing, editor, openEditor, confirmDelete, renderReceiverCell])

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

  /** 路由树卡操作区：
   *  - 只读态只给「编辑路由」一个入口；
   *  - 编辑态只给「新建 / 保存 / 放弃」三个动作，不再有「重新载入」。 */
  const routeActions = editing ? (
    <Space wrap>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} data-testid="route-new-btn">
        新建路由规则
      </Button>
      <Button
        type="primary"
        onClick={() => void handleSave()}
        loading={editor.saving}
        data-testid="route-save-btn"
      >
        保存并提交变更
      </Button>
      <Button onClick={handleDiscard} data-testid="route-reset-btn">
        放弃编辑
      </Button>
    </Space>
  ) : (
    <Button
      type="primary"
      icon={<EditOutlined />}
      onClick={enterEdit}
      loading={enteringEdit}
      data-testid="route-enter-edit-btn"
    >
      编辑路由
    </Button>
  )

  /** 编辑态附属说明：载入提示 + 保存口径。 */
  const routeActionNotes = editing ? (
    <>
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
        保存会生成整份 alertmanager.yml 并提交变更单；改动不会立即生效，需在「配置变更确认」中人工确认后才会写入并 reload。
      </Text>
    </>
  ) : null

  /** 「需要处理」条目（2026-10-14 布局优化）。
   *
   *  背景：原先 partial / saveResult / blocking / warning 是四条各自独立的 Alert 平铺，
   *  最坏情况四条同时出现——四条同样醒目、同样占满宽度的色块，视觉噪音远大于信息量，
   *  反而让「真正阻断保存的那一条」被淹没。现收敛为一张卡，条目按 severity 从高到低排列。
   *
   *  不收进本卡的两类（它们是「替代视图」而非「一行提示」，塞进来反而更吵）：
   *  - 整页 error：独占三元分支，与其他内容互斥；
   *  - degraded 降级卡：承载可滚动 YAML 原文 + 「重新加载」+ 唯一的补齐入口。
   *  deadReceivers 同理保留独立卡——它带接收人清单与「两种处理方式」，本身是内容主体。
   */
  const notices: RouteNotice[] = []
  if (editor.blocking.length > 0) {
    notices.push({
      key: 'precheck-blocking',
      level: 'error',
      testId: 'route-precheck-blocking',
      title: `保存前预检未通过（${editor.blocking.length} 项，必须修正后才能保存）`,
      body: (
        <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
          {editor.blocking.map((i, idx) => (
            <li key={idx}>{i.message}</li>
          ))}
        </ul>
      ),
    })
  }
  if (editor.saveResult) {
    notices.push({
      key: 'save-result',
      level: editor.saveResult.ok ? 'success' : 'error',
      testId: 'route-save-result',
      title: editor.saveResult.ok ? '已提交，等待你在「配置变更确认」中确认下发' : '保存未通过',
      body: editor.saveResult.ok ? (
        <Space direction="vertical" size={4}>
          <span>{editor.saveResult.message}</span>
          {/* 成功后的唯一下一步就是去 M09 确认（提交只产 pending 草稿，不即时生效）。 */}
          <Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>
        </Space>
      ) : (
        editor.saveResult.message
      ),
    })
  }
  if (editor.importState === 'partial' && editor.importNotice) {
    notices.push({
      key: 'import-partial',
      level: 'warning',
      testId: 'route-import-notice',
      title: '当前配置无法完整解析，已从空白路由树开始，请手动补齐',
      body: editor.importNotice,
    })
  }
  if (editor.warnings.length > 0) {
    notices.push({
      key: 'precheck-warning',
      level: 'warning',
      testId: 'route-precheck-warning',
      title: `可以保存，但有 ${editor.warnings.length} 项建议确认`,
      body: (
        <ul style={{ paddingLeft: 20, margin: '8px 0 0 0' }}>
          {editor.warnings.map((i, idx) => (
            <li key={idx}>{i.message}</li>
          ))}
        </ul>
      ),
    })
  }
  const sortedNotices = [...notices].sort(
    (a, b) => NOTICE_LEVEL_ORDER[a.level] - NOTICE_LEVEL_ORDER[b.level]
  )

  return (
    <MainLayout>
      {/* 页头 + 说明区（四页统一，见 components/PageIntro.tsx）。
          说明区只留**不随状态变化**、且**不约束某一具体区块**的机制说明：
          「一条规则包含什么」是全页概念；而「顶层路由是总入口」只约束路由树那一张表，
          已下沉到表格正上方（ROUTE_TREE_LEAD_IN），折叠区里再放一遍等于让用户
          展开折叠区才能知道哪一行不能拖。 */}
      <PageIntro
        testId="routes-intro"
        title="路由规则"
        subtitle="查看告警路由树；点「编辑路由」后按标签把告警分流到不同通知渠道"
        points={[
          '一条规则包含：匹配条件（发什么）、接收人（发给谁）、分组与节奏（怎么攒批、多久重发）。',
          '页面默认只读；点「编辑路由」进入编辑，保存会生成整份配置并提交变更单，确认下发后才会生效。',
        ]}
      />

      {submitted && (
        <Alert
          type="success"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          data-testid="route-submitted-notice"
          message="路由变更已提交，等待确认下发"
          description={
            <Space direction="vertical" size={2}>
              <span>改动尚未生效，需在「配置变更确认」中人工确认后才会写入并 reload Alertmanager。</span>
              <Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>
            </Space>
          }
          onClose={() => setSubmitted(false)}
        />
      )}

      {error ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="路由规则加载失败，请稍后重试"
          description={error}
          action={
            <Button size="small" onClick={() => reload()}>
              重新加载
            </Button>
          }
        />
      ) : (
        <>
          {/* 解析失败降级：原文只读展示 + 提示（不白屏、不报错页）；
              只读态可点「编辑路由」从空白路由树开始手动补齐 */}
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
            <Space style={{ marginTop: 12 }} wrap>
              <Button size="small" onClick={() => reload()}>
                重新加载
              </Button>
              {/* degraded 时 showTree=false（除非已导入进入编辑态），路由树卡不存在，
                  操作区改挂此处——否则这条唯一的「补齐入口」会随操作卡一起消失。 */}
              {routeActions}
            </Space>
            {routeActionNotes}
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

          {/* 2026-10-14 布局优化：原此处「新建 / 导入 / 保存 / 放弃」独占一张无标题 Card，
              已删除——按钮操作的就是下方那张路由树，挂在路由树卡 extra 里就近得多。
              degraded 态的挂载点见上方降级卡（showTree=false 时路由树卡不渲染）。 */}

          {/* 需要处理：保存前预检阻断 / 保存结果 / 部分导入 / 预检建议，四合一。
              完整导入的成功提示不进这里——它属于「已完成的正常操作」，挂在操作区按钮旁。 */}
          {sortedNotices.length > 0 && (
            <Card
              style={{ marginBottom: 16 }}
              data-testid="route-notices"
              title={
                <Space size={8}>
                  <WarningOutlined />
                  需要处理
                  <Tag color={NOTICE_LEVEL_COLOR[sortedNotices[0].level]}>
                    {sortedNotices.length}
                  </Tag>
                </Space>
              }
            >
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {sortedNotices.map((n) => (
                  <Alert
                    key={n.key}
                    type={n.level}
                    showIcon
                    data-testid={n.testId}
                    message={n.title}
                    description={n.body}
                  />
                ))}
              </Space>
            </Card>
          )}

          {/* 有 pending 草稿时明确告知：页面展示的是待确认版本，AM 仍在跑上一版 */}
          {pending && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              data-testid="route-pending-banner"
              message="当前显示的是待确认版本"
              description={
                <Space direction="vertical" size={2}>
                  <span>
                    变更单 {pending.change_no} 尚未确认下发，Alertmanager 仍在运行上一版配置。
                  </span>
                  <Link to={CONFIG_PREVIEW_PATH}>前往「配置变更确认」</Link>
                </Space>
              }
            />
          )}

          {showTree && (
          <Card
            title={
              <Space size={8}>
                路由树
                {editing ? <Tag color="processing">可编辑</Tag> : <Tag>只读</Tag>}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {viewRows.length} 个节点
                </Text>
                {/* 「顺序即生效顺序」原在页头下方常驻 info Alert 里（与模式徽标、可编辑性指引
                    混在一块）。2026-10-14 Alert 整块删除后，本句迁到它真正约束的那张表的标题行
                    ——顺序只对这张表有意义，紧贴表格比占据页面顶端更合理。 */}
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {ROUTE_ORDER_TIP}
                </Text>
              </Space>
            }
            /* 操作按钮迁入 extra（2026-10-14）：原先独占一张无标题 Card。 */
            extra={routeActions}
          >
            {/* 载入提示与保存口径：贴在表格正上方，紧邻其指引的「保存并提交变更」按钮 */}
            {routeActionNotes}
            {/* 读表须知（2026-10-14 从 PageIntro 折叠要点下沉）：「顶层路由是总入口」约束的
                是这张表里哪一行不能动，放在表格正上方才看得出说的是哪一行。 */}
            <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
              {ROUTE_TREE_LEAD_IN}
            </Text>
            <Table<RouteViewRow>
              rowKey={(row) => row.id}
              dataSource={viewRows}
              columns={columns}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty description="当前暂无路由配置，点右上角「编辑路由」开始配置" /> }}
              onRow={(row) => {
                const draggable = editing && !row.locked
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
    </MainLayout>
  )
}

/** 取节点父 ID（供同级排序定位；找不到返回空串） */
function parentIdOf(tree: RouteEditNode[], id: string): string {
  return tree.find((n) => n.id === id)?.parent_id ?? ''
}
