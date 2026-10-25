import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Dropdown,
  Empty,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { CloudServerOutlined, DownOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../../layouts/MainLayout'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { EllipsisText } from '../../../components/EllipsisText'
import { getStoredUser } from '../../../api/client'
import { edgeAgentsApi } from '../../../api/edgeAgents'
import { formatRelativeTime } from '../configCenterConstants'
import type { AgentView, ConfigSyncStatus } from '../../../types/edge'
import { useEdgeAgents } from './useEdgeAgents'
import { EdgeAgentDrawer } from './EdgeAgentDrawer'
import {
  BACKLOG_AGE_TOOLTIP,
  CHANNEL_STATUS_TOOLTIP,
  agentStatusBadgeStatus,
  agentStatusLabel,
  channelStatusBadge,
  channelStatusLabel,
  componentStatusColor,
  componentStatusLabel,
  configSyncDisplayBadgeStatus,
  configSyncDisplayLabel,
  configSyncStatusLabel,
  formatBacklogAge,
  formatBacklogBytes,
  formatBacklogGrowth,
  outOfSyncCauseAction,
} from './edgeConstants'

const { Text } = Typography

/** 整体状态筛选选项（按节点存活视角 AgentStatus；partial 为整体聚合档不作为 per-agent 筛选项） */
const OVERALL_OPTIONS = (['online', 'offline', 'unknown', 'retired'] as const).map((s) => ({
  value: s,
  label: agentStatusLabel[s],
}))

/** 组件状态筛选选项（采集器/拨测器共用） */
const COMPONENT_STATUS_OPTIONS = (['running', 'restarting', 'crash_loop', 'not_deployed', 'unknown'] as const).map(
  (s) => ({ value: s, label: componentStatusLabel[s] }),
)

const CONFIG_SYNC_OPTIONS = (['in_sync', 'out_of_sync', 'unknown', 'manual_override', 'no_version'] as const).map(
  (s) => ({ value: s, label: configSyncStatusLabel[s] }),
)

/** 节点中某类组件的首个守护状态 Tag；无则该类型的组件显示 '-' */
function componentColumn(agent: AgentView, type: 'collector' | 'blackbox_exporter'): ReactNode {
  const comp = (agent.components ?? []).find((c) => c.type === type)
  if (!comp) return <Text type="secondary">-</Text>
  return <Tag color={componentStatusColor[comp.status]}>{componentStatusLabel[comp.status]}</Tag>
}

/**
 * 采集节点状态页（Module_09 §11.1 / M11 契约 §1 — P0 完整页）。
 * 消费 GET /edge-agents：顶部三档聚合统计 + 平铺节点表，含组件/配置同步/回传积压诊断。
 * 覆盖：加载 / 接口错误 / 空态三支（筛选后空、暂无采集节点、中心直连域）/ 权限不足 / 五维筛选 / 详情抽屉。
 */
export function EdgeAgentsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [detailAgent, setDetailAgent] = useState<AgentView | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const deepLinkDomain = searchParams.get('network_domain') ?? undefined
  const {
    agents,
    rawAgents,
    summary,
    loading,
    error,
    domains,
    filters,
    setFilters,
    resetFilters,
    hasActiveFilter,
    reload,
  } = useEdgeAgents(deepLinkDomain)

  const domainOptions = domains.map((d) => ({ value: d.id, label: `${d.name}（${d.id}）` }))

  // F-42：人工重启采集进程仅管理员可见/可操作（后端 RequireAdmin 兜底），非 admin 隐藏入口。
  const isAdmin = getStoredUser()?.role === 'admin'

  const openDetail = (record: AgentView) => {
    setDetailAgent(record)
    setDetailOpen(true)
  }

  /** 重启入口仅在线节点可用；offline/unknown（心跳超时按离线口径展示）/retired 一律禁用 */
  const restartable = (record: AgentView) => record.status === 'online'

  /** F-43 清空回传积压：与重启一致的在线前置；破坏性操作二次确认文案需红色警示 */
  const flushable = restartable

  /**
   * F-43 清空回传积压：登记破坏性 seq 指令（下次心跳执行「停 vmagent → 删持久队列
   * → 重新拉起」，积压数据永久丢弃，换取回传通道实时性恢复）。确认弹窗必须红色警示
   * 丢弃量，防止误触。
   */
  const confirmFlushBacklog = (record: AgentView) => {
    Modal.confirm({
      title: '清空回传积压',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            确定要清空节点「{record.hostname}」的回传积压（
            {formatBacklogBytes(record.queue_backlog_bytes)}）吗？
          </p>
          <p style={{ color: '#cf1322', marginBottom: 8, fontWeight: 600 }}>
            这是破坏性操作：队列内全部积压数据将被永久丢弃，无法恢复。
          </p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>节点会先停止采集回传，清空 vmagent 持久队列后立即重新拉起；约 30s 内随下次心跳下发执行；</li>
            <li>适用于积压过大、数据时效已无法容忍的止血场景（当前积压大概率已过时）；</li>
            <li>清空后回传积压归零、新数据实时回传；如需避免再次积压，请调整采集间隔或下发积压磁盘上限。</li>
          </ul>
        </div>
      ),
      okText: '确认清空（数据丢弃）',
      okType: 'danger',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await edgeAgentsApi.flushBacklog(record.id)
          message.success(`节点「${record.hostname}」清空积压指令已登记，约 30s 内随下次心跳执行`)
          reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '清空积压指令登记失败，请稍后重试')
        }
      },
    })
  }

  /** F-42 人工重启采集进程：登记 seq 指令（约 30s 内随下次心跳下发执行，幂等滚动重启） */
  const confirmRestart = (record: AgentView) => {
    Modal.confirm({
      title: '重启采集进程',
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>确定要重启节点「{record.hostname}」的采集进程（vmagent）吗？</p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>仅滚动重启 vmagent 采集子进程，采集节点本体与持久队列不受影响，队列数据不丢；</li>
            <li>指令约 30s 内随节点下次心跳下发执行（幂等，重复心跳不会重复重启）；</li>
            <li>重启期间该节点采集短暂中断，随后自动恢复。</li>
          </ul>
        </div>
      ),
      okText: '确认重启',
      okType: 'primary',
      cancelText: '取消',
      onOk: async () => {
        try {
          await edgeAgentsApi.restart(record.id)
          message.success(`节点「${record.hostname}」重启指令已登记，约 30s 内随下次心跳执行`)
          reload()
        } catch (err) {
          message.error(err instanceof Error ? err.message : '重启指令登记失败，请稍后重试')
        }
      },
    })
  }

  const updateFilter = (key: keyof typeof filters, value: string | undefined) => {
    setFilters({ ...filters, [key]: value })
  }

  const columns: ColumnsType<AgentView> = [
    {
      title: '节点',
      key: 'node',
      width: 200,
      fixed: 'left',
      render: (_: unknown, record: AgentView) => (
        <div>
          <div style={{ lineHeight: '22px' }}>{record.hostname}</div>
          <Text type="secondary" style={{ fontSize: 12, lineHeight: '18px' }}>{record.ip}</Text>
        </div>
      ),
    },
    {
      title: '网域',
      dataIndex: 'network_domain_id',
      key: 'network_domain_id',
      width: 140,
      render: (v: string) => <EllipsisText maxWidth={120}>{v || '-'}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (s: AgentView['status']) => (
        <Badge status={agentStatusBadgeStatus[s]} text={agentStatusLabel[s]} />
      ),
    },
    {
      title: '采集器',
      key: 'collector',
      width: 110,
      render: (_: unknown, record: AgentView) => componentColumn(record, 'collector'),
    },
    {
      title: '拨测器',
      key: 'blackbox',
      width: 110,
      render: (_: unknown, record: AgentView) => componentColumn(record, 'blackbox_exporter'),
    },
    {
      title: (
        <Tooltip title="Agent 已拉取配置包版本相对于中心的同步程度；未同步可按成因引导处理">
          <Space size={4}>
            配置同步
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      key: 'config_sync',
      width: 150,
      render: (_: unknown, record: AgentView) => {
        const st = record.config_sync_status ?? 'unknown'
        const cause = record.out_of_sync_cause
        const causeAction = cause ? outOfSyncCauseAction[cause] : null
        const badge = (
          <Badge
            status={configSyncDisplayBadgeStatus(st, cause)}
            text={configSyncDisplayLabel(st, cause)}
          />
        )
        return (
          <Space size={6}>
            {/* pull_pending（已确认下发、待心跳拉取）展示「同步中」；apply_failed 展示「同步失败」（F-16 / D-2）。
                应用失败时以 Tooltip 展示错误摘要（列宽有限，错误全文走详情抽屉）。 */}
            {record.config_apply_error ? (
              <Tooltip title={record.config_apply_error}>{badge}</Tooltip>
            ) : (
              badge
            )}
            {causeAction && (
              <Button
                type="link"
                size="small"
                onClick={() => navigate(causeAction.target ?? '#')}
              >
                {causeAction.text}
              </Button>
            )}
          </Space>
        )
      },
    },
    {
      title: '回传积压',
      dataIndex: 'queue_backlog_bytes',
      key: 'queue_backlog_bytes',
      width: 130,
      render: (v?: number, record?: AgentView) => {
        const label = channelStatusLabel(record?.channel_status)
        const badge = channelStatusBadge(record?.channel_status)
        return (
          <Space size={6}>
            <span>{formatBacklogBytes(v)}</span>
            {label && badge && (
              <Tooltip title={CHANNEL_STATUS_TOOLTIP}>
                <Badge status={badge} text={label} />
              </Tooltip>
            )}
          </Space>
        )
      },
    },
    {
      // F-40 延展①：积压数据龄 = 当前积压 ÷ 近期增速（相邻心跳差分），量化「积压还要多久才能被消费完」。
      title: (
        <Tooltip title={BACKLOG_AGE_TOOLTIP}>
          <Space size={4}>
            积压数据龄
            <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
          </Space>
        </Tooltip>
      ),
      dataIndex: 'backlog_age_seconds',
      key: 'backlog_age_seconds',
      width: 120,
      render: (age?: number | null, record?: AgentView) => {
        const text = formatBacklogAge(age)
        if (text === '-') return <Text type="secondary">-</Text>
        const growth = formatBacklogGrowth(record?.backlog_growth_bytes_per_sec)
        return (
          <Tooltip title={`近期积压增速：${growth}${typeof age === 'number' ? `，按此速率约 ${text} 攒满当前积压` : ''}`}>
            <span>{text}</span>
          </Tooltip>
        )
      },
    },
    {
      title: '最后心跳',
      dataIndex: 'last_heartbeat',
      key: 'last_heartbeat',
      width: 130,
      render: (v?: string) => (v ? formatRelativeTime(v) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_: unknown, record: AgentView) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={() => openDetail(record)}>查看</Button>
          {isAdmin && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'restart',
                    disabled: !restartable(record),
                    // 离线/退役节点禁用并说明原因（F-42：节点离线时禁用重启入口）
                    label: restartable(record) ? (
                      '重启采集进程'
                    ) : (
                      <Tooltip title={record.status === 'retired' ? '节点已退役，无法下发重启指令' : '节点离线，无法下发重启指令'}>
                        <span>重启采集进程</span>
                      </Tooltip>
                    ),
                  },
                  {
                    // F-43 清空回传积压（破坏性）：同样仅在线节点可下发；离线时禁用并说明
                    key: 'flush-backlog',
                    danger: true,
                    disabled: !flushable(record),
                    label: flushable(record) ? (
                      '清空回传积压'
                    ) : (
                      <Tooltip title={record.status === 'retired' ? '节点已退役，无法下发清空指令' : '节点离线，无法下发清空指令'}>
                        <span>清空回传积压</span>
                      </Tooltip>
                    ),
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'restart' && restartable(record)) confirmRestart(record)
                  // 破坏性操作必须在 onClick 处再判一次在线（与 disabled 双保险）
                  if (key === 'flush-backlog' && flushable(record)) confirmFlushBacklog(record)
                },
              }}
              trigger={['click']}
            >
              <Button type="link" size="small">
                <Space size={2}>更多<DownOutlined style={{ fontSize: 10 }} /></Space>
              </Button>
            </Dropdown>
          )}
        </Space>
      ),
    },
  ]

  /** 空态三支判定：筛选后空 / 中心直连域 / 暂无采集节点 */
  const noAgents = rawAgents.length === 0
  const hasAgentPullDomain = domains.some((d) => d.channel === 'agent_pull')

  let emptyTitle: ReactNode = '暂无采集节点'
  if (hasActiveFilter) {
    emptyTitle = '无匹配的采集节点'
  } else if (noAgents && !hasAgentPullDomain) {
    emptyTitle = '暂无 agent_pull 网域（中心直连域）'
  } else if (noAgents) {
    emptyTitle = '尚未接入采集节点'
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card
          title={
            <Space size={4}>
              采集节点状态
              <Tooltip title="展示所有部署了 Edge Agent 的边缘节点；每个节点展示主机名/IP、网域、整体状态、组件运行状态、配置同步与回传积压等。">
                <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
              </Tooltip>
            </Space>
          }
        >
          {/* 顶部三档聚合统计 */}
          <Space size={16} style={{ marginBottom: 16 }}>
            <StatCard label="正常" color="success" value={summary?.online ?? 0} />
            <StatCard label="部分异常" color="processing" value={summary?.partial ?? 0} />
            <StatCard label="离线" color="error" value={summary?.offline ?? 0} />
            <StatCard label="总数" color="default" value={summary?.total ?? 0} />
          </Space>

          {error && (
            <Alert
              type="error"
              showIcon
              message="采集节点列表加载失败，请稍后重试"
              description={error}
              action={<Button size="small" icon={<ReloadOutlined />} onClick={reload}>重新加载</Button>}
              style={{ marginBottom: 16 }}
            />
          )}
          {hasActiveFilter && domainOptions.length > 0 && (
            <Alert
              type="info"
              showIcon
              message={filters.network_domain_id ? `已按网域「${filters.network_domain_id}」预筛（跳转自网域纳管页）` : '已启用筛选'}
              action={<Button size="small" onClick={resetFilters}>退出筛选</Button>}
              style={{ marginBottom: 16 }}
            />
          )}

          <FilterBar>
            <FilterItem label="网域" width={240}>
              <Select
                allowClear
                placeholder="全部网域"
                style={{ width: 220 }}
                value={filters.network_domain_id || undefined}
                options={domainOptions}
                onChange={(v) => updateFilter('network_domain_id', v)}
                showSearch
                optionFilterProp="label"
              />
            </FilterItem>
            <FilterItem label="整体状态" width={180}>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 160 }}
                value={filters.overall || undefined}
                options={OVERALL_OPTIONS}
                onChange={(v) => updateFilter('overall', v)}
              />
            </FilterItem>
            <FilterItem label="采集器" width={180}>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 160 }}
                value={filters.collector_status || undefined}
                options={COMPONENT_STATUS_OPTIONS}
                onChange={(v) => updateFilter('collector_status', v)}
              />
            </FilterItem>
            <FilterItem label="拨测器" width={180}>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 160 }}
                value={filters.blackbox_status || undefined}
                options={COMPONENT_STATUS_OPTIONS}
                onChange={(v) => updateFilter('blackbox_status', v)}
              />
            </FilterItem>
            <FilterItem label="配置同步" width={180}>
              <Select
                allowClear
                placeholder="全部"
                style={{ width: 160 }}
                value={filters.config_sync_status || undefined}
                options={CONFIG_SYNC_OPTIONS}
                onChange={(v) => updateFilter('config_sync_status', v as ConfigSyncStatus | undefined)}
              />
            </FilterItem>
          </FilterBar>

          <Table<AgentView>
            rowKey="id"
            dataSource={agents}
            loading={loading}
            columns={columns}
            scroll={TABLE_SCROLL_X}
            locale={{
              emptyText:
                noAgents || hasActiveFilter ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={emptyTitle}
                  >
                    {!hasActiveFilter && noAgents && (
                      <Button type="primary" icon={<CloudServerOutlined />} onClick={() => navigate('/domain-onboarding')}>
                        去网域纳管
                      </Button>
                    )}
                  </Empty>
                ) : (
                  <Empty description="暂无采集节点" />
                ),
            }}
            pagination={{
              ...TABLE_PAGINATION,
              total: agents.length,
            }}
          />
        </Card>

        <EdgeAgentDrawer
          open={detailOpen}
          agent={detailAgent}
          onClose={() => setDetailOpen(false)}
        />
      </ConfigProvider>
    </MainLayout>
  )
}

/** 顶部三档统计小卡片 */
function StatCard({ label, color, value }: { label: string; color: 'success' | 'processing' | 'error' | 'default'; value: number }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Badge status={color} />
      <Text>{label}</Text>
      <Text strong style={{ fontSize: 18 }}>{value}</Text>
    </div>
  )
}

export default EdgeAgentsPage