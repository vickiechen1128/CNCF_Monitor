import { useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import { CloudServerOutlined, QuestionCircleOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { MainLayout } from '../../../layouts/MainLayout'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../../components/tablePresets'
import { FilterBar, FilterItem } from '../../../components/FilterBar'
import { EllipsisText } from '../../../components/EllipsisText'
import { formatRelativeTime } from '../configCenterConstants'
import type { AgentView, ConfigSyncStatus } from '../../../types/edge'
import { useEdgeAgents } from './useEdgeAgents'
import { EdgeAgentDrawer } from './EdgeAgentDrawer'
import {
  agentStatusBadgeStatus,
  agentStatusLabel,
  componentStatusColor,
  componentStatusLabel,
  configSyncStatusBadgeStatus,
  configSyncStatusLabel,
  formatBacklogBytes,
  outOfSyncCauseAction,
} from './edgeConstants'

const { Text } = Typography

/** 整体状态筛选选项（按节点存活视角 AgentStatus） */
const OVERALL_OPTIONS = (['online', 'partial', 'offline', 'retired'] as const).map((s) => ({
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

  const openDetail = (record: AgentView) => {
    setDetailAgent(record)
    setDetailOpen(true)
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
        return (
          <Space size={6}>
            <Badge status={configSyncStatusBadgeStatus[st]} text={configSyncStatusLabel[st]} />
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
      width: 110,
      render: (v?: number) => formatBacklogBytes(v),
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
      width: 90,
      fixed: 'right',
      render: (_: unknown, record: AgentView) => (
        <Button type="link" size="small" onClick={() => openDetail(record)}>查看</Button>
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
              message={filters.network_domain_id ? `已按网域「${filters.network_domain_id}」预筛（来自深链）` : '已启用筛选'}
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