/**
 * 「路由规则」页 v0.3-b（T08-F10 只读路由树 + T08-F11 三段式表单编辑）。
 *
 * 契约：Module_08 §11.7（列表态 / 编辑态）/ §9.1（v0.3-a / v0.3-b）；task-sequence T08-F10 / T08-F11。
 * 数据：`GET /api/v2/platform/alertmanager/routes`（T08-12，仅全局认证、只读无写能力）。
 *
 * 模式定位（PRD §11.7 / 提案 §4.3「单一作者 + 模式开关」）：
 * - **手写模式**：本页**整体只读**（无新建 / 编辑 / 删除 / 拖拽入口），只把文件里的 route 渲染成树帮用户看懂；
 * - **平台管理模式**：可写（新建 / 编辑 / 删除 / 上移下移 / 拖拽 / 从当前配置导入），
 *   保存 = 生成整份 alertmanager.yml → 复用既有 `POST /api/v2/platform/alertmanager/config`
 *   （**零新增端点**）→ 触发 M09 变更单，**不即时生效**。
 *
 * 解析失败时降级为原文只读展示（不白屏、不报错页）；平台模式下另给「部分导入 + 手动校正」通道。
 *
 * ⚠ 模式开关 UI 由 T08-F12 落地；本轮沿用 `GET /routes` 返回的 `mode`（与 T08-F10 同源），
 * `useRouteSetting` 尚无 mode 字段（见汇报「需澄清点」）。
 */
import { useCallback, useMemo, useState } from 'react'
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
import { ALERT_CONFIG_PATH, NOTIFY_CHANNELS_PATH, formatMatchers } from './alertmanagerConstants'
import { isRouteEditable, useRouteEditor, useRoutes } from './useRoutes'
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

/** 模式徽标文案（T08-F12：手写接管 / 平台管理） */
const ROUTE_MODE_LABEL: Record<RouteMode, string> = {
  handwritten: '手写接管',
  managed: '平台管理',
}

/** 模式徽标配色：手写=中性，平台=处理中（蓝） */
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
  const { data, rows, loading, error, reload } = useRoutes()
  const { modal } = App.useApp()
  const mode: RouteMode = data?.mode ?? 'handwritten'
  const parseError = (data?.parse_error ?? '').trim()
  const degraded = parseError.length > 0
  const deadReceivers: DeadReceiver[] = data?.dead_receivers ?? []
  const editable = isRouteEditable(mode)

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
    onSaved: reload,
    confirmPartialImport,
  })
  const editing = editor.importState !== 'empty'
  /** 解析失败时先只给原文；平台模式下导入（部分导入）后仍需渲染编辑树供手动校正 */
  const showTree = !degraded || (editable && editing)

  /** 已知接收人集合（H1/H2 共用）：已启用渠道物化的 AM receiver 名，用于悬空校验与「未定义」渲染 */
  const knownReceiverSet = useMemo(() => new Set(editor.knownReceivers), [editor.knownReceivers])

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
          return (
            <EllipsisText code maxWidth={180}>
              {row.receiver}
            </EllipsisText>
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
  }, [editable, editing, editor, openEditor, confirmDelete])

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
          「这页管什么 / 怎么编辑」这类说明收进默认收起的说明区，不占首屏。 */}
      <PageIntro
        testId="routes-intro"
        title="路由规则"
        subtitle="决定「哪条告警发给谁」：按标签匹配 → 落到某个接收人"
        points={[
          '路由顺序 = 生效顺序：先匹配到的先生效，所以同层级的顺序决定谁先被检查。',
          '一条规则包含：匹配条件（发什么）、接收人（发给谁）、分组与节奏（怎么攒批、多久重发）。',
          mode === 'handwritten'
            ? '当前由你手写维护，本页为只读展示；如需可视化编辑，请先在「告警配置」页把「路由规则由谁维护」切到「平台管理」。'
            : '当前由平台管理，可新建 / 编辑 / 拖拽调整顺序；保存后进入变更单，人工确认后下发生效，不即时生效。',
          '顶层路由是所有告警的总入口，不可删除、不可移动；它同时承载「未匹配任何规则的告警发给谁」。',
        ]}
      />

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
          mode === 'handwritten' ? (
            <Text>
              本页为只读展示：不提供新建 / 编辑 / 拖拽入口。
              <Link to={ALERT_CONFIG_PATH}>前往告警配置</Link> 可切换为「平台管理」。
            </Text>
          ) : (
            <Text>
              选中行用上移 / 下移（或直接拖拽行）调整同级顺序，顶层路由锁定不可移动。
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

          {/* 孤立接收人：平台已生成但没有任何路由指向（dev-feedback #26），显性标出并可跳转处理 */}
          {!degraded && deadReceivers.length > 0 && (
            <Card
              title={
                <Space size={8}>
                  <WarningOutlined />
                  孤立接收人（平台已生成但没有任何路由指向）
                  <Tag color="warning">{deadReceivers.length}</Tag>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <Text type="secondary">
                以下接收人由平台自动生成，但当前路由树里没有任何一条路由指向它们——告警永远不会发往它们。
                请点击前往「通知渠道」页处理。
              </Text>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                {deadReceivers.map((d) => (
                  <li key={d.name} style={{ marginBottom: 4 }}>
                    <Link to={NOTIFY_CHANNELS_PATH} data-testid={`dead-receiver-${d.name}`}>
                      <Text code>{d.name}</Text>
                    </Link>
                    <Text type="secondary"> — {d.url}</Text>
                  </li>
                ))}
              </ul>
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
                  从当前配置导入
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
              <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                保存会生成整份 alertmanager.yml 并提交挂载，进入变更单人工确认后下发生效，不即时生效。
              </Text>
            </Card>
          )}

          {/* 导入提示（完整导入 / 不可无损导入） */}
          {editable && editor.importNotice && (
            <Alert
              type={editor.importState === 'partial' ? 'warning' : 'success'}
              showIcon
              style={{ marginBottom: 16 }}
              data-testid="route-import-notice"
              message={editor.importState === 'partial' ? '部分导入：不可无损导入，请手动校正' : '已从当前配置导入'}
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
              message={editor.saveResult.ok ? '已提交，待变更单确认下发' : '保存未通过'}
              description={editor.saveResult.message}
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
