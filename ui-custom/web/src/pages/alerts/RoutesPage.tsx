/**
 * 「路由规则」页 v0.3-a（只读路由树，T08-F10）。
 *
 * 契约：Module_08 §11.7（列表态）/ §9.1（v0.3-a）；task-sequence T08-F10。
 * 数据：`GET /api/v2/platform/alertmanager/routes`（T08-12，仅全局认证、只读无写能力）。
 *
 * 只读定位：本页**不提供任何写入口**（无新建 / 编辑 / 拖拽）——route 段作者模式为「单一作者 + 模式开关」，
 * 手写模式（本期恒此）下用户手写维护、平台只渲染；如需在此编辑，需先在「告警配置」页开启「路由规则由平台管理」
 * （v0.3-b，T08-F11 落地表单）。解析失败时降级为原文只读展示（不白屏、不报错页）。
 */
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Empty, Space, Table, Tag, Tooltip, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { LockOutlined, WarningOutlined } from '@ant-design/icons'
import { EllipsisText } from '../../components/EllipsisText'
import { MainLayout } from '../../layouts/MainLayout'
import { ALERT_CONFIG_PATH, NOTIFY_CHANNELS_PATH, formatMatchers } from './alertmanagerConstants'
import { useRoutes, type RouteRow } from './useRoutes'
import type { DeadReceiver, RouteAuthorMode, RouteMatcher, RouteNode } from '../../types/alertmanager'

const { Text } = Typography

/** 常驻顶部说明：顺序即优先级（PRD §11.7） */
const ROUTE_ORDER_TIP = '路由顺序 = 生效顺序：先匹配到的先生效'

/** 模式徽标文案（PRD §11.7：手写接管 / 平台管理） */
const ROUTE_MODE_LABEL: Record<RouteAuthorMode, string> = {
  handwritten: '手写接管',
  platform: '平台管理',
}

/** 模式徽标配色：手写=中性，平台=处理中（蓝） */
const ROUTE_MODE_COLOR: Record<RouteAuthorMode, string> = {
  handwritten: 'default',
  platform: 'processing',
}

/** 顶层路由锁定说明（Tooltip） */
const ROUTE_ROOT_LOCK_TIP = '顶层路由（对应 Alertmanager 的 route: 本体，即最外层的路由入口），不可删除、不可移动'

/** 路由名称展示：无注释名不造值——顶层路由显式化，子路由标注未命名 */
function routeDisplayName(node: RouteNode): string {
  const name = (node.name ?? '').trim()
  if (name) return name
  return node.locked ? '顶层路由' : '（未命名路由）'
}

/** 匹配条件展示串：空 = 兜底（匹配所有告警），复用静默页同款 matcher 格式化 */
function routeMatchersText(matchers: RouteMatcher[]): string {
  if (!matchers || matchers.length === 0) return '（匹配所有告警，兜底）'
  return formatMatchers(matchers)
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
  const mode: RouteAuthorMode = data?.mode ?? 'handwritten'
  const parseError = (data?.parse_error ?? '').trim()
  const degraded = parseError.length > 0
  const deadReceivers: DeadReceiver[] = data?.dead_receivers ?? []

  const columns: ColumnsType<RouteRow> = [
    {
      title: '路由名称',
      key: 'name',
      render: (_: unknown, row: RouteRow) => (
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingLeft: row.depth * 20 }}
        >
          {row.depth > 0 && (
            <span style={{ fontFamily: 'monospace', color: 'rgba(0, 0, 0, 0.25)' }}>└─</span>
          )}
          {row.node.locked && (
            <Tooltip title={ROUTE_ROOT_LOCK_TIP}>
              <LockOutlined data-testid="route-root-lock" />
            </Tooltip>
          )}
          <EllipsisText strong={row.node.locked} maxWidth={220}>
            {routeDisplayName(row.node)}
          </EllipsisText>
          {row.node.locked && <Tag color="blue">顶层</Tag>}
        </span>
      ),
    },
    {
      title: '匹配条件',
      key: 'matchers',
      render: (_: unknown, row: RouteRow) => (
        <EllipsisText code maxWidth={260}>
          {routeMatchersText(row.node.matchers)}
        </EllipsisText>
      ),
    },
    {
      title: '接收人',
      key: 'receiver',
      render: (_: unknown, row: RouteRow) =>
        row.node.receiver ? (
          <EllipsisText code maxWidth={180}>
            {row.node.receiver}
          </EllipsisText>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '分组键',
      key: 'group_by',
      render: (_: unknown, row: RouteRow) =>
        row.node.group_by.length > 0 ? (
          <EllipsisText maxWidth={200}>{row.node.group_by.join(', ')}</EllipsisText>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: '发送节奏',
      key: 'timing',
      render: (_: unknown, row: RouteRow) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.node.group_wait || '-'} / {row.node.group_interval || '-'} /{' '}
          {row.node.repeat_interval || '-'}
        </Text>
      ),
    },
    {
      title: '继续匹配',
      key: 'continue',
      width: 100,
      render: (_: unknown, row: RouteRow) =>
        row.node.continue ? <Tag color="processing">是</Tag> : <Tag>否</Tag>,
    },
  ]

  return (
    <MainLayout>
      <div className="page-header">
        <Typography.Title level={4} style={{ margin: 0 }}>
          路由规则
        </Typography.Title>
        <Text type="secondary">
          看懂「告警发给谁、按什么条件分、怎么攒批、多久重发」——route 段的可视化查看（当前版本只读）
        </Text>
      </div>

      {/* 常驻顶部说明（顺序即优先级）+ 模式徽标（按 mode 渲染） */}
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
          <Space direction="vertical" size={2}>
            <Text>本页为只读展示：不提供新建 / 编辑 / 拖拽入口。</Text>
            {mode === 'handwritten' ? (
              <Text>
                如需编辑路由规则，请先在「告警配置」页开启「路由规则由平台管理」。{' '}
                <Link to={ALERT_CONFIG_PATH}>前往告警配置</Link>
              </Text>
            ) : (
              <Text>路由规则由平台管理，表单编辑能力将在后续版本提供。</Text>
            )}
          </Space>
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
      ) : degraded ? (
        // 解析失败降级：原文只读展示 + 提示（不白屏、不报错页）
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
          <Button size="small" style={{ marginTop: 12 }} onClick={reload}>
            重新加载
          </Button>
        </Card>
      ) : (
        <>
          {/* 孤立接收人：平台已生成但没有任何路由指向（dev-feedback #26），显性标出并可跳转处理 */}
          {deadReceivers.length > 0 && (
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

          <Card
            title={
              <Space size={8}>
                路由树
                <Tag>只读</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  共 {rows.length} 个节点
                </Text>
              </Space>
            }
          >
            <Table<RouteRow>
              rowKey={(row) => row.node.id}
              dataSource={rows}
              columns={columns}
              loading={loading}
              pagination={false}
              size="middle"
              scroll={{ x: 'max-content' }}
              locale={{ emptyText: <Empty description="当前无生效配置，或 route 段为空" /> }}
            />
          </Card>
        </>
      )}
    </MainLayout>
  )
}