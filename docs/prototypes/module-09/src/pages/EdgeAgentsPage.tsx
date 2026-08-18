import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Table, Tag, Row, Col, Statistic, Space, Typography, Tooltip, Select, Empty, Alert, Button, Drawer, Descriptions, Modal, message } from 'antd'
import { ReloadOutlined, QuestionCircleOutlined, LinkOutlined, ArrowRightOutlined, SyncOutlined, ExclamationCircleFilled } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import { ReviewNote } from '../components/ReviewNote'
import { FilterBar, FilterItem } from '../components/FilterBar'
import { TABLE_SCROLL_X, TABLE_PAGINATION } from '../components/tablePresets'
import {
  edgeAgents,
  networkDomains,
  channelLabel,
  channelTip,
  type Channel,
  type EdgeComponentType,
  type EdgeComponent,
  type EdgeAgent,
  type ConfigSyncStatus,
} from '../mocks/module-09'

const { Text } = Typography

/** {v1.37} 跨模块跳转链接（决策 D27-2 保存感知反向动线）：「去配置采集 Job」跳 Module_01 采集 Job 页并预选网域；原型演示用相对路径 */
const MODULE_LINKS = {
  module01: '../module-01/dist/index.html',
} as const

/** 组件运行状态（PRD 3.2 组件分类 / 决策 15）：Edge Sync Agent 用在线/离线，采集器与拨测器等进程组件用运行中/已停止 */
const componentStatusColor: Record<EdgeComponent['status'], { color: string; label: string }> = {
  online: { color: 'success', label: '在线' },
  offline: { color: 'error', label: '离线' },
  running: { color: 'success', label: '运行中' },
  stopped: { color: 'error', label: '已停止' },
  unknown: { color: 'default', label: '未知' },
}

/** 组件类型分类（PRD 3.2 / 3.9 边缘节点组件构成 / 决策 15） */
const componentTypeLabel: Record<EdgeComponentType, string> = {
  edge_sync_agent: 'Edge Sync Agent',
  collector: '指标采集器',
  blackbox_exporter: '拨测器',
  vmalert: '边缘告警（vmalert）',
  alertmanager: '边缘通知（alertmanager）',
}

const componentTypeTip: Record<EdgeComponentType, string> = {
  edge_sync_agent: '必装独立组件：负责心跳 / 配置拉取 / 控制本节点采集器与拨测器（非中心平台内置）',
  collector: '指标采集器：vmagent / prometheus-agent 二选一（由网域 agent_type 登记），负责抓取与 remote_write，由 Edge Sync Agent 部署守护',
  blackbox_exporter: '拨测器（可选）：网域存在 job_type=blackbox 的 ScrapeJob 时随一体化包附带，由 Edge Sync Agent 部署守护',
  vmalert: '边缘自治告警组件（v0.4+，P2）：随配置包 rules.yml（scope=edge/both，由配置中心自动派生分组）下发后启动本地求值（断网自治告警）',
  alertmanager: '边缘告警通知组件（v0.4+，P2）：alertmanager.yml 由告警通知模块统一管理（不随本配置包下发），本地通知通道（飞书 / 钉钉 webhook，断网独立通知）',
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/** 整体状态（决策 36-2）：基于组件状态聚合的三档状态 */
type OverallStatus = 'normal' | 'partial_abnormal' | 'offline'

const overallStatusConfig: Record<OverallStatus, { color: string; label: string }> = {
  normal: { color: 'success', label: '正常' },
  partial_abnormal: { color: 'warning', label: '部分异常' },
  offline: { color: 'error', label: '离线' },
}

/** 计算节点的整体状态 */
function computeOverallStatus(agent: EdgeAgent): OverallStatus {
  const syncAgent = agent.components.find((c) => c.type === 'edge_sync_agent')
  if (!syncAgent || syncAgent.status === 'offline') return 'offline'
  const hasCollectorIssue = agent.components.some(
    (c) => c.type === 'collector' && c.status !== 'running'
  )
  const hasBlackboxIssue = agent.components.some(
    (c) => c.type === 'blackbox_exporter' && c.status !== 'running'
  )
  if (hasCollectorIssue || hasBlackboxIssue) return 'partial_abnormal'
  return 'normal'
}

/** 获取拨测器状态文本 */
function getBlackboxStatus(agent: EdgeAgent): string {
  const bb = agent.components.find((c) => c.type === 'blackbox_exporter')
  if (!bb) return 'not_deployed'
  return bb.status
}

/** 获取拨测器状态颜色 */
function getBlackboxStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return 'success'
    case 'stopped':
      return 'error'
    case 'not_deployed':
      return 'default'
    default:
      return 'default'
  }
}

/** 获取拨测器状态标签 */
function getBlackboxStatusLabel(status: string): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'stopped':
      return '已停止'
    case 'not_deployed':
      return '未部署'
    default:
      return '未知'
  }
}

export function EdgeAgentsPage() {
  const navigate = useNavigate()
  // {v1.40} 决策 40-4：agent 列表本地态（「立即同步」后延迟更新 config_sync_status → in_sync，原型以 mock 模拟 force-sync API）
  const [agents, setAgents] = useState<EdgeAgent[]>(edgeAgents)
  // {v1.40} 决策 40-4：正在执行「立即同步」的 Agent id（按钮 loading）
  const [syncingAgentId, setSyncingAgentId] = useState<string | null>(null)
  const hasAnyAgent = agents.length > 0

  // 筛选状态
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>(undefined)
  const [selectedOverallStatus, setSelectedOverallStatus] = useState<OverallStatus | undefined>(undefined)
  const [selectedCollectorStatus, setSelectedCollectorStatus] = useState<string | undefined>(undefined)
  const [selectedBlackboxStatus, setSelectedBlackboxStatus] = useState<string | undefined>(undefined)
  const [selectedConfigSync, setSelectedConfigSync] = useState<ConfigSyncStatus | undefined>(undefined)

  // Drawer 状态
  const [drawerAgent, setDrawerAgent] = useState<EdgeAgent | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 错误详情 Modal 状态
  const [errorModalOpen, setErrorModalOpen] = useState(false)
  const [errorModalData, setErrorModalData] = useState<{ component: EdgeComponent; agent: EdgeAgent } | null>(null)

  const domainMap = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
  }, [])

  const channelByDomainId = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.channel])) as Record<string, Channel>
  }, [])

  // 筛选后的节点列表
  const filteredAgents = useMemo(() => {
    let list = [...agents]
    if (selectedDomain) {
      list = list.filter((a) => a.network_domain_id === selectedDomain)
    }
    if (selectedOverallStatus) {
      list = list.filter((a) => computeOverallStatus(a) === selectedOverallStatus)
    }
    if (selectedCollectorStatus) {
      list = list.filter((a) => a.collector_status === selectedCollectorStatus)
    }
    if (selectedBlackboxStatus) {
      list = list.filter((a) => getBlackboxStatus(a) === selectedBlackboxStatus)
    }
    if (selectedConfigSync) {
      list = list.filter((a) => a.config_sync_status === selectedConfigSync)
    }
    return list
  }, [agents, selectedDomain, selectedOverallStatus, selectedCollectorStatus, selectedBlackboxStatus, selectedConfigSync])

  // 统计卡
  const stats = useMemo(() => {
    const total = agents.length
    const online = agents.filter((a) => a.status === 'online').length
    const collectorRunning = agents.filter((a) => a.collector_status === 'running').length
    const blackboxRunning = agents.filter((a) => {
      const bb = a.components.find((c) => c.type === 'blackbox_exporter')
      return bb?.status === 'running'
    }).length
    return { total, online, collectorRunning, blackboxRunning }
  }, [agents])

  // 打开 Drawer 查看组件详情
  const openDrawer = (agent: EdgeAgent) => {
    setDrawerAgent(agent)
    setDrawerOpen(true)
  }

  /** {v1.40} 决策 40-4「立即同步」：中心置 force_pull 标记，Agent 下次心跳无视版本一致强制重新拉包；
   *  原型以 mock 模拟——按钮 loading → 延迟（模拟心跳拉包）→ config_sync_status → in_sync */
  const handleForceSync = (agent: EdgeAgent) => {
    setSyncingAgentId(agent.id)
    message.loading({ content: `正在向网域下发强制同步标记，等待 ${agent.hostname} 下次心跳拉包...`, key: `sync-${agent.id}` })
    setTimeout(() => {
      setAgents((prev) =>
        prev.map((a) =>
          a.id === agent.id
            ? {
                ...a,
                config_sync_status: 'in_sync',
                out_of_sync_cause: undefined,
                last_error: '',
                last_config_pull: new Date().toLocaleString('zh-CN', { hour12: false }),
                components: a.components.map((c) => ({ ...c, last_error: undefined })),
              }
            : a
        )
      )
      setSyncingAgentId(null)
      message.success({ content: `${agent.hostname} 已强制重新拉包并 reload 生效（config_sync_status → in_sync）`, key: `sync-${agent.id}` })
    }, 1800)
  }

  const filterBar = (
    <FilterBar>
      <FilterItem label="网域" width={250}>
        <Select
          allowClear
          placeholder="全部网域"
          style={{ width: 160 }}
          value={selectedDomain}
          onChange={(v) => setSelectedDomain(v)}
          options={networkDomains
            .filter((d) => agents.some((a) => a.network_domain_id === d.id))
            .map((d) => ({ value: d.id, label: `${d.name}（${d.id}）` }))}
        />
      </FilterItem>
      <FilterItem label="整体状态">
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 130 }}
          value={selectedOverallStatus}
          onChange={(v) => setSelectedOverallStatus(v)}
          options={[
            { value: 'normal', label: '正常' },
            { value: 'partial_abnormal', label: '部分异常' },
            { value: 'offline', label: '离线' },
          ]}
        />
      </FilterItem>
      <FilterItem label="采集器状态" width={240}>
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 130 }}
          value={selectedCollectorStatus}
          onChange={(v) => setSelectedCollectorStatus(v)}
          options={[
            { value: 'running', label: '运行中' },
            { value: 'stopped', label: '已停止' },
            { value: 'unknown', label: '未知' },
          ]}
        />
      </FilterItem>
      <FilterItem label="拨测器状态" width={240}>
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 130 }}
          value={selectedBlackboxStatus}
          onChange={(v) => setSelectedBlackboxStatus(v)}
          options={[
            { value: 'running', label: '运行中' },
            { value: 'stopped', label: '已停止' },
            { value: 'not_deployed', label: '未部署' },
            { value: 'unknown', label: '未知' },
          ]}
        />
      </FilterItem>
      <FilterItem label="配置同步" width={240}>
        <Select
          allowClear
          placeholder="全部"
          style={{ width: 130 }}
          value={selectedConfigSync}
          onChange={(v) => setSelectedConfigSync(v)}
          options={[
            { value: 'in_sync', label: '已同步' },
            { value: 'out_of_sync', label: '未同步' },
            { value: 'manual_override', label: '人工覆盖' },
            { value: 'no_version', label: '未下发配置' },
            { value: 'unknown', label: '未知' },
          ]}
        />
      </FilterItem>
    </FilterBar>
  )

  const [bannerClosed, setBannerClosed] = useState(() => localStorage.getItem('edgeAgentsBannerClosed') === 'true')

  return (
    <MainLayout>
      {/* PRD 3.8.1：页面顶部组件关系说明横幅，改为可关闭 Alert，默认展示，关闭后记住用户选择 */}
      {!bannerClosed && (
        <Alert
          type="info"
          showIcon
          closable
          message="组件关系说明"
          description="一次安装 = 三个进程：Edge Sync Agent（管理进程）+ 采集器 vmagent（采集指标）+ 拨测器 blackbox（可选）。Edge Sync Agent 负责拉取配置并守护另外两个进程，某个进程异常会被自动重启并在此处展示。"
          style={{ margin: '0 0 16px' }}
          onClose={() => {
            localStorage.setItem('edgeAgentsBannerClosed', 'true')
            setBannerClosed(true)
          }}
        />
      )}

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="采集节点总数" value={stats.total} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="在线节点" value={stats.online} valueStyle={{ color: '#00B578' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="采集器运行中" value={stats.collectorRunning} valueStyle={{ color: '#00B578' }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="拨测器运行中" value={stats.blackboxRunning} valueStyle={{ color: '#0ECDEB' }} />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space size={4}>
            采集节点状态
            <Tooltip title="展示所有部署了 Edge Agent 的边缘节点的采集节点状态；每行代表一个采集节点（Edge Agent 实例），展示主机名/IP、网域、整体状态、组件运行状态、配置同步等信息；点击行或「查看」按钮可展开组件详情抽屉">
              <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
            </Tooltip>
          </Space>
        }
      >
        {hasAnyAgent && filterBar}
        {!hasAnyAgent ? (
          <Alert
            type="info"
            showIcon
            message="暂未接入任何采集节点"
            description="系统中暂无 EdgeAgent 实例。请先在「网域纳管」页完成 agent_pull 通道网域的监控纳管，并按页面顶部「安装指引」在边缘节点接入 Edge Sync Agent（心跳上报后自动出现在本页）。local 通道网域（如 default）由中心直接采集，不部署 Edge Agent。"
          />
        ) : filteredAgents.length === 0 ? (
          <Empty description="当前筛选条件下无采集节点" />
        ) : (
          <>
            <Table
              dataSource={filteredAgents}
              rowKey="id"
              size="small"
              className="edge-agent-table"
              rowClassName={(record) => (computeOverallStatus(record) === 'partial_abnormal' ? 'row-partial-abnormal' : '')}
              scroll={TABLE_SCROLL_X}
              pagination={TABLE_PAGINATION}
              onRow={(record) => ({
                style: { cursor: 'pointer' },
                onClick: () => openDrawer(record),
              })}
              columns={[
                {
                  title: '节点（主机名 / IP）',
                  key: 'node',
                  width: 220,
                  fixed: 'left',
                  render: (_: unknown, record: EdgeAgent) => (
                    <Space direction="vertical" size={2}>
                      <Text strong>{record.hostname}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {record.agent_ip}
                      </Text>
                    </Space>
                  ),
                },
                {
                  title: '网域',
                  key: 'domain',
                  width: 160,
                  render: (_: unknown, record: EdgeAgent) => {
                    const domain = networkDomains.find((d) => d.id === record.network_domain_id)
                    return (
                      <Space direction="vertical" size={2}>
                        <Space size={4}>
                          <Text>{domain?.name ?? record.network_domain_id}</Text>
                          <Tooltip title={channelTip[channelByDomainId[record.network_domain_id] ?? 'agent_pull']}>
                            <Tag color="blue" style={{ fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                              {channelLabel[channelByDomainId[record.network_domain_id] ?? 'agent_pull']}
                            </Tag>
                          </Tooltip>
                        </Space>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {record.network_domain_id}
                        </Text>
                      </Space>
                    )
                  },
                },
                {
                  title: (
                    <Tooltip title="整体状态（三档）：正常=全部组件健康；部分异常=Edge Sync Agent 在线但采集器/拨测器异常；离线=Edge Sync Agent 离线">
                      <Space size={4}>
                        整体状态
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'overall-status',
                  width: 120,
                  render: (_: unknown, record: EdgeAgent) => {
                    const status = computeOverallStatus(record)
                    const cfg = overallStatusConfig[status]
                    return <Tag color={cfg.color}>{cfg.label}</Tag>
                  },
                },
                {
                  title: (
                    <Tooltip title="Edge Sync Agent（配置轮询采集器）运行状态：负责心跳 / 配置拉取 / 守护本节点采集器与拨测器；在线/离线两档">
                      <Space size={4}>
                        Edge Sync Agent
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'sync-agent-status',
                  width: 130,
                  render: (_: unknown, record: EdgeAgent) => {
                    const sa = record.components.find((c) => c.type === 'edge_sync_agent')
                    const cfg = componentStatusColor[sa?.status ?? 'unknown']
                    return <Tag color={cfg.color}>{cfg.label}</Tag>
                  },
                },
                {
                  title: (
                    <Tooltip title="采集器运行状态（由 Edge Sync Agent 部署守护，进程异常自动重启并上报）">
                      <Space size={4}>
                        采集器状态
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'collector-status',
                  width: 120,
                  render: (_: unknown, record: EdgeAgent) => {
                    const cfg = componentStatusColor[record.collector_status as EdgeComponent['status']]
                    return <Tag color={cfg.color}>{cfg.label}</Tag>
                  },
                },
                {
                  title: (
                    <Tooltip title="拨测器（blackbox exporter）运行状态；未部署表示该网域无 blackbox 采集 Job">
                      <Space size={4}>
                        拨测器状态
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'blackbox-status',
                  width: 120,
                  render: (_: unknown, record: EdgeAgent) => {
                    const status = getBlackboxStatus(record)
                    return (
                      <Tag color={getBlackboxStatusColor(status)}>
                        {getBlackboxStatusLabel(status)}
                      </Tag>
                    )
                  },
                },
                {
                  title: (
                    <Tooltip title="配置同步状态（五档，未同步按成因分档展示）：已同步；待确认变更=中心有待确认变更草稿→「前往配置确认」；生效中=已确认后等待 Agent 拉包/生效（无需操作）→「查看下发记录」；本地校验失败=checksum 校验失败保留旧配置→「立即同步」；人工覆盖=本地修改（纯展示）；未下发配置→「去配置采集 Job」；未知。local 通道网域由下发记录派生，见「配置变更确认」页同步状态">
                      <Space size={4}>
                        配置同步
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'config-sync',
                  width: 260,
                  render: (_: unknown, record: EdgeAgent) => {
                    const cause = record.out_of_sync_cause
                    // {v1.42} 决策 40-1 修订：out_of_sync 不再统一显示「未同步」，按成因分档展示标签与颜色，
                    // 与下一步按钮一一对应（待确认变更→前往配置确认 / 生效中→查看下发记录 / 本地校验失败→立即同步），
                    // 避免三种按钮并存时都挂「未同步」标签造成认知混淆
                    const syncConfig: Record<ConfigSyncStatus, { color: string; label: string }> = {
                      in_sync: { color: 'success', label: '已同步' },
                      out_of_sync:
                        cause === 'pending_draft'
                          ? { color: 'gold', label: '待确认变更' }
                          : cause === 'pull_pending'
                            ? { color: 'blue', label: '生效中' }
                            : cause === 'local_reset'
                              ? { color: 'volcano', label: '本地校验失败' }
                              : { color: 'warning', label: '未同步' },
                      manual_override: { color: 'error', label: '人工覆盖' },
                      unknown: { color: 'default', label: '未知' },
                      no_version: { color: 'default', label: '未下发配置' },
                    }
                    const cfg = syncConfig[record.config_sync_status]
                    return (
                      <Space size={4}>
                        <Tag color={cfg.color}>{cfg.label}</Tag>
                        {/* {v1.40 决策 40-1} out_of_sync 按成因渲染引导（标签分档见 syncConfig） */}
                        {record.config_sync_status === 'out_of_sync' && cause === 'pending_draft' && (
                          <Button
                            type="link"
                            size="small"
                            icon={<ArrowRightOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/config-preview?network_domain=${record.network_domain_id}`)
                            }}
                          >
                            前往配置确认
                          </Button>
                        )}
                        {record.config_sync_status === 'out_of_sync' && cause === 'pull_pending' && (
                          <Tooltip title="无待确认变更，Agent 拉包/生效延迟（网络波动 / 瞬时 reload 失败自动重试中），等待心跳自动流转为已同步，无需操作">
                            <Button
                              type="link"
                              size="small"
                              icon={<LinkOutlined />}
                              onClick={(e) => {
                                e.stopPropagation()
                                navigate(`/deployments?network_domain=${record.network_domain_id}`)
                              }}
                            >
                              查看下发记录
                            </Button>
                          </Tooltip>
                        )}
                        {record.config_sync_status === 'out_of_sync' && cause === 'local_reset' && (
                          <Button
                            type="link"
                            size="small"
                            icon={<SyncOutlined spin={syncingAgentId === record.id} />}
                            loading={syncingAgentId === record.id}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleForceSync(record)
                            }}
                          >
                            立即同步
                          </Button>
                        )}
                        {record.config_sync_status === 'no_version' && (
                          <Button
                            type="link"
                            size="small"
                            icon={<ArrowRightOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(`${MODULE_LINKS.module01}?view=jobs&network_domain=${record.network_domain_id}`, '_blank')
                            }}
                          >
                            去配置采集 Job
                          </Button>
                        )}
                      </Space>
                    )
                  },
                },
                {
                  title: 'WAL 积压',
                  key: 'wal',
                  width: 100,
                  render: (_: unknown, record: EdgeAgent) => (
                    <Text>{record.wal_backlog_bytes > 0 ? formatBytes(record.wal_backlog_bytes) : '0 B'}</Text>
                  ),
                },
                {
                  title: '最后心跳',
                  key: 'last-heartbeat',
                  width: 140,
                  render: (_: unknown, record: EdgeAgent) => <Text>{record.last_heartbeat}</Text>,
                },
                {
                  title: '操作',
                  key: 'action',
                  width: 80,
                  fixed: 'right',
                  render: (_: unknown, record: EdgeAgent) => (
                    <Tooltip title="查看组件详情">
                      <Button
                        type="link"
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          openDrawer(record)
                        }}
                      >
                        查看
                      </Button>
                    </Tooltip>
                  ),
                },
              ]}
            />
            <ReviewNote title="设计说明：展示范围 / 配置同步五档 / 边缘约束（面向产品 / 技术评审）" style={{ margin: '12px 0 0' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                展示范围（决策 31/32/33）：仅展示部署了 Edge Agent 的网域——local 通道网域（default）由中心直接采集、不部署 Edge Agent，
                不产生 EdgeAgent 实例、不出现在本页（与域类型解耦，通道绑定采集节点位置）；菜单常驻展示，无实例时展示空态引导。
                每行代表一个采集节点（Edge Agent 实例），支持按网域 / 整体状态 / 采集器状态 / 拨测器状态 / 配置同步多维度筛选。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                展示结构：节点列表（主机名 / IP / 网域 / 整体状态 / Edge Sync Agent 状态 / 采集器状态 / 拨测器状态 / 配置同步 / WAL 积压 / 最后心跳），
                点击行或「查看」按钮展开组件详情抽屉，展示该节点下各组件（Edge Sync Agent / 采集器 / 拨测器）的运行状态、版本、配置版本、最近错误。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                配置同步状态说明（五档，{`{v1.37}`} 决策 37-1）：<Text code>in_sync</Text>=已同步（中心与边缘版本一致）；
                <Text code>out_of_sync</Text>=未同步，{`{v1.42}`} **按成因分档展示（决策 40-1）**，标签与下一步按钮一一对应，避免多按钮并存时统一显示「未同步」造成迷惑——成因 A（<Text code>pending_draft</Text>）=<Text code>待确认变更</Text>：中心存在待确认变更草稿 →「前往配置确认」（预选该网域）；成因 B（<Text code>pull_pending</Text>）=<Text code>生效中</Text>：采集器运行正常、配置已确认后等待 Agent 拉包/生效（典型场景：变更确认后在等待）→ **纯展示等待**（心跳自动变为已同步，无需操作）+「查看下发记录」链接；成因 C（<Text code>local_reset</Text>）=<Text code>本地校验失败</Text>：本地环境/地址变化、checksum 校验失败保留旧配置 →「立即同步」强制重新拉包（无视版本一致 304）；
                采集器进程异常（已停止）属于组件健康问题：配置版本已同步（in_sync），不在配置同步列给引导按钮，从详情抽屉查看组件错误与维修提示。
                <Text code>manual_override</Text>=人工覆盖（本地手工兜底；平台不强制 reconcile，纯展示，需人工重新确认下发恢复一致性）；
                <Text code>no_version</Text>=未下发配置（Agent 已上线但网域尚无配置版本）→ 可点击「去配置采集 Job」（跳 Module_01 预选网域）；
                <Text code>unknown</Text>=未知（未上报配置版本）。local 通道网域（default）不产生 EdgeAgent 实例，其网域级配置同步状态由下发记录派生，展示于「配置变更确认」页（决策 37-1）。
                Agent IP / 主机名由 Edge Sync Agent 心跳上报登记，仅展示，不参与配置下发。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                边缘传输校验：Edge Sync Agent 拉包后按{' '}
                <Text code>metadata.json</Text> 联合 checksum 做完整性校验，解压后对{' '}
                <Text code>targets/*.json</Text> 做解析校验（JSON 结构、targets / labels 字段合法性），失败保留最后一份有效配置并记录错误，体现为{' '}
                <Text code>config_sync_status</Text> 异常态（out_of_sync / manual_override）；Agent 为「哑校验」，不做 promtool 级语法校验，产物合法性由中心内容校验（validation_status）保证。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                网闸 / 隔离区连接约束（{`{v1.31}`}）：政务云等网闸隔离场景下禁止任何中心 → 边缘方向的主动连接，
                所有交互（心跳 / 配置拉取 / 指标回传）一律由边缘 Agent 向中心发起（pull / push 上行），中心无入站端口；
                面向边缘的地址（center_endpoint / remote_write_url）均为该网域视角的可达地址（网闸映射后地址），
                配置拉取地址 = 网域 center_endpoint + 相对路径合成绝对地址。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                边缘告警组件（{`{v1.32}`}）：vmalert（v0.4+，P2）随配置包中的{' '}
                <Text code>rules.yml</Text>（scope=edge/both，分组由配置中心自动派生）下发后启动本地求值（断网自治告警）；
                alertmanager.yml 由 Module_08（告警收敛与通知管理）统一管理，不随本模块配置包下发，
                边缘本地通知通道（飞书 / 钉钉 webhook）由 Module_08 独立配置。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                断网自治（{`{v1.28}`}）：断网期间配置草稿 / 版本在中心正常生成与存储（不影响发布流程）；
                边缘 Agent 保留<Text strong>最后一份有效配置</Text>继续自治采集（本地快照，不依赖中心在线），
                网络恢复后心跳上报配置版本 → 中心响应有更新 → 拉取该网域最新已审批版本（网域内版本一致 + checksum 校验）。
              </Text>
            </ReviewNote>
          </>
        )}
      </Card>

      {/* 组件详情 Drawer */}
      <Drawer
        title={drawerAgent ? `节点详情：${drawerAgent.hostname}（${drawerAgent.agent_ip}）` : '节点详情'}
        placement="right"
        width={560}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {drawerAgent && (
          <>
            {/* {v1.42} 组件健康异常（Edge Sync Agent 在线但采集器/拨测器异常）的高影响提示：
                与配置同步无关（配置仍可显示「已同步」），监控已中断，须上机修复 */}
            {computeOverallStatus(drawerAgent) === 'partial_abnormal' && (
              <div
                style={{
                  background: '#FFF1F0',
                  border: '1px solid #FFCCC7',
                  borderLeft: '4px solid #FF4D4F',
                  borderRadius: 6,
                  padding: '12px 16px',
                  marginBottom: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <ExclamationCircleFilled style={{ color: '#FF4D4F', marginTop: 3 }} />
                  <div>
                    <Text strong style={{ color: '#CF1322', fontSize: 14 }}>
                      监控采集中断，需立即处理
                    </Text>
                    <div style={{ marginTop: 4, fontSize: 12, color: '#820014' }}>
                      采集器/拨测器进程异常，该节点指标已停止采集与回传，相关告警和看板将失效。
                      此异常与配置同步无关（配置仍显示「已同步」），平台无法远程修复；请登录该边缘节点用 systemd 重启服务，
                      或按「网域纳管」安装指引重装离线包。
                    </div>
                  </div>
                </div>
              </div>
            )}
            <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
              Agent 是管理进程，负责拉取配置并守护其他进程；进程异常会被自动重启并在此展示。
            </Text>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="节点名称">{drawerAgent.hostname}</Descriptions.Item>
              <Descriptions.Item label="IP 地址">{drawerAgent.agent_ip}</Descriptions.Item>
              <Descriptions.Item label="所属网域">
                {domainMap[drawerAgent.network_domain_id] ?? drawerAgent.network_domain_id}
              </Descriptions.Item>
              <Descriptions.Item label="Agent 版本">{drawerAgent.version}</Descriptions.Item>
              <Descriptions.Item label="Agent 状态">
                <Tag color={componentStatusColor[drawerAgent.status as EdgeComponent['status']].color}>
                  {componentStatusColor[drawerAgent.status as EdgeComponent['status']].label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="最后心跳">{drawerAgent.last_heartbeat}</Descriptions.Item>
              <Descriptions.Item label="WAL 积压">
                {drawerAgent.wal_backlog_bytes > 0 ? formatBytes(drawerAgent.wal_backlog_bytes) : '0 B'}
              </Descriptions.Item>
            </Descriptions>

            <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12 }}>
              维修提示：进程持续异常时，登录边缘节点用 systemd 重启服务，或按「网域纳管」安装指引重装离线包（MVP 不提供中心侧远程重启）。
            </Text>

            <Text strong style={{ display: 'block', marginBottom: 12 }}>
              组件列表
            </Text>
            {/* {v1.36 原型修正} 按组件分区展示，不再使用 Table 子表 */}
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {drawerAgent.components.map((comp) => {
                const cfg = componentStatusColor[comp.status]
                const typeLabel = componentTypeLabel[comp.type]
                const typeTip = componentTypeTip[comp.type]
                // 错误摘要：截断约 80 字符
                const errorSummary = comp.last_error
                  ? comp.last_error.length > 80
                    ? comp.last_error.slice(0, 80) + '...'
                    : comp.last_error
                  : null
                return (
                  <Card
                    key={`${comp.type}-${comp.name}`}
                    size="small"
                    type="inner"
                    title={
                      <Tooltip title={typeTip}>
                        <Tag color="blue">{typeLabel}</Tag>
                      </Tooltip>
                    }
                    extra={
                      // 组件状态 Tag
                      <Tag color={cfg.color}>{cfg.label}</Tag>
                    }
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size={4}>
                      {/* 实例名：截断 + Tooltip */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>实例名：</Text>
                        <Tooltip title={comp.name}>
                          <Text code ellipsis style={{ maxWidth: 300, fontSize: 12 }}>
                            {comp.name}
                          </Text>
                        </Tooltip>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <span>
                          <Text type="secondary" style={{ fontSize: 12 }}>版本：</Text>
                          <Text style={{ fontSize: 12 }}>{comp.version}</Text>
                        </span>
                        {comp.config_version && (
                          <span>
                            <Text type="secondary" style={{ fontSize: 12 }}>配置版本：</Text>
                            <Text code style={{ fontSize: 12 }}>{comp.config_version}</Text>
                          </span>
                        )}
                      </div>
                      {/* 最近错误：一句话摘要 + 查看详情按钮 */}
                      {errorSummary ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>最近错误：</Text>
                          <Text type="danger" ellipsis style={{ maxWidth: 280, fontSize: 12 }}>
                            {errorSummary}
                          </Text>
                          <Button
                            type="link"
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation()
                              setErrorModalData({ component: comp, agent: drawerAgent })
                              setErrorModalOpen(true)
                            }}
                          >
                            查看错误详情
                          </Button>
                        </div>
                      ) : (
                        <Text type="secondary" style={{ fontSize: 12 }}>无错误记录</Text>
                      )}
                    </Space>
                  </Card>
                )
              })}
            </Space>
          </>
        )}
      </Drawer>

      {/* 错误详情 Modal（不嵌套抽屉，避免层级混乱） */}
      <Modal
        title="错误详情"
        open={errorModalOpen}
        onCancel={() => setErrorModalOpen(false)}
        footer={null}
        width={640}
      >
        {errorModalData && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="所属节点">
              {errorModalData.agent.hostname}（{errorModalData.agent.agent_ip}）
            </Descriptions.Item>
            <Descriptions.Item label="所属组件">
              <Tag color="blue">{componentTypeLabel[errorModalData.component.type]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="组件实例名">{errorModalData.component.name}</Descriptions.Item>
            <Descriptions.Item label="关联配置版本">
              {errorModalData.component.config_version || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="发生时间">
              {errorModalData.agent.last_heartbeat}
            </Descriptions.Item>
            <Descriptions.Item label="错误详情">
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  background: '#f5f5f5',
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  maxHeight: 300,
                  overflow: 'auto',
                }}
              >
                {errorModalData.component.last_error || '无错误信息'}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </MainLayout>
  )
}

export default EdgeAgentsPage