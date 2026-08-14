import { useMemo, useState } from 'react'
import { Card, Table, Tag, Row, Col, Statistic, Space, Typography, Tooltip, Select, Empty, Alert } from 'antd'
import { ReloadOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { MainLayout } from '../layouts/MainLayout'
import {
  edgeAgents,
  networkDomains,
  currentTenant,
  type EdgeComponentType,
  type EdgeComponent,
  type EdgeAgent,
  type NetworkDomain,
} from '../mocks/module-09'

const { Text } = Typography

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
  vmalert: '边缘自治告警组件（v0.4+，P2）：随 rules.yml 下发后启动本地求值（断网自治告警）',
  alertmanager: '边缘告警通知组件（v0.4+，P2）：随 alertmanager.yml 下发后启动本地通知通道',
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/** 网域聚合行（一级表）：聚合该网域下全部边缘节点 Agent 的组件状态（PRD 3.8.1 / 决策 15/16） */
interface DomainAggRow {
  key: string
  domainId: string
  domainName: string
  domainType: NetworkDomain['domain_type']
  agents: EdgeAgent[]
  agentsTotal: number
  syncOnline: number
  collectorRunning: number
  collectorTotal: number
  blackboxRunning: number
  blackboxTotal: number
  outOfSyncCount: number
  walSum: number
  lastHeartbeat: string
}

/**
 * 仅聚合「有 Edge Agent 的网域」（决策 16）：default 管理域中心直接采集、不部署 Edge Agent，
 * 因此不进入 Agent 状态页；筛选后的 default 亦不会出现。
 * componentType 为组件类型筛选（决策 16）：一级表对应列（采集器 / 拨测器）仅统计匹配类型的组件。
 */
function buildDomainRows(domains: NetworkDomain[], componentType?: EdgeComponentType): DomainAggRow[] {
  return domains.map((d) => {
    const agents = edgeAgents.filter((a) => a.network_domain_id === d.id)
    const components = agents.flatMap((a) => a.components)
    const filtered = (t: EdgeComponentType) =>
      !componentType || componentType === t ? components.filter((c) => c.type === t) : []
    const collectors = filtered('collector')
    const blackboxes = filtered('blackbox_exporter')
    const lastHeartbeat = agents.map((a) => a.last_heartbeat).sort().reverse()[0] ?? '-'
    return {
      key: d.id,
      domainId: d.id,
      domainName: d.name,
      domainType: d.domain_type,
      agents,
      agentsTotal: agents.length,
      syncOnline: agents.filter((a) => a.status === 'online').length,
      collectorRunning: collectors.filter((c) => c.status === 'running').length,
      collectorTotal: collectors.length,
      blackboxRunning: blackboxes.filter((c) => c.status === 'running').length,
      blackboxTotal: blackboxes.length,
      outOfSyncCount: agents.filter(
        (a) => a.config_sync_status === 'out_of_sync' || a.config_sync_status === 'manual_override'
      ).length,
      walSum: agents.reduce((sum, a) => sum + a.wal_backlog_bytes, 0),
      lastHeartbeat,
    }
  })
}

export function EdgeAgentsPage() {
  const multiSite = currentTenant.multi_site_enabled
  // 决策 13：多网域模式支持按网域筛选（网域下拉）；单网域模式固定 default
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>(undefined)
  // 决策 16：组件类型筛选（联动展开明细与统计卡；一级表对应列仅统计匹配组件）
  const [selectedComponentType, setSelectedComponentType] = useState<EdgeComponentType | undefined>(undefined)

  const domainMap = useMemo(() => {
    return Object.fromEntries(networkDomains.map((d) => [d.id, d.name]))
  }, [])

  const effectiveSelectedDomain = multiSite ? selectedDomain : 'default'

  // 一级表：仅展示「有 Edge Agent 的网域」（决策 16）；单网域模式（default 管理域无 Agent）为空态
  const rows = useMemo(() => {
    const domainsWithAgents = networkDomains.filter((d) => edgeAgents.some((a) => a.network_domain_id === d.id))
    const domains = (multiSite ? domainsWithAgents : []).filter(
      (d) => !effectiveSelectedDomain || d.id === effectiveSelectedDomain
    )
    return buildDomainRows(domains, selectedComponentType)
  }, [effectiveSelectedDomain, multiSite, selectedComponentType])

  // 统计卡随网域筛选 / 组件类型筛选联动（决策 16）：仅统计展示中的网域行，并按组件类型口径计算
  const stats = useMemo(() => {
    const domainTotal = rows.length
    const syncOnline = rows.reduce((sum, r) => sum + r.syncOnline, 0)
    const collectorRunning = rows.reduce((sum, r) => sum + r.collectorRunning, 0)
    const blackboxRunning = rows.reduce((sum, r) => sum + r.blackboxRunning, 0)
    return { domainTotal, syncOnline, collectorRunning, blackboxRunning }
  }, [rows])

  // 展开子表：该网域下组件实例，按组件类型分类展示；组件类型筛选时仅展示匹配类型（决策 16）
  const renderComponentRows = (agents: EdgeAgent[]) => {
    const rowsData = agents.flatMap((agent) =>
      agent.components
        .filter((c) => !selectedComponentType || c.type === selectedComponentType)
        .map((component) => ({ key: `${agent.id}-${component.type}`, agent, component }))
    )
    return (
      <Table
        size="small"
        dataSource={rowsData}
        rowKey="key"
        pagination={false}
        locale={{ emptyText: '该网域在当前组件类型筛选下无组件' }}
        columns={[
          {
            title: '组件类型',
            key: 'component-type',
            width: 200,
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) => {
              const label =
                record.component.type === 'collector'
                  ? `指标采集器（${record.agent.agent_type}）`
                  : componentTypeLabel[record.component.type]
              return (
                <Tooltip title={componentTypeTip[record.component.type]}>
                  <Tag color="blue">{label}</Tag>
                </Tooltip>
              )
            },
          },
          {
            title: '组件实例',
            key: 'component-name',
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) => (
              <Text code>{record.component.name}</Text>
            ),
          },
          {
            title: '所属节点',
            key: 'hostname',
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) => (
              <Text>{record.agent.hostname}</Text>
            ),
          },
          {
            title: '状态',
            key: 'component-status',
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) => {
              const cfg = componentStatusColor[record.component.status]
              return <Tag color={cfg.color}>{cfg.label}</Tag>
            },
          },
          {
            title: '版本',
            key: 'component-version',
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) => (
              <Text>{record.component.version}</Text>
            ),
          },
          {
            title: '配置版本',
            key: 'component-config-version',
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) =>
              record.component.config_version ? (
                <Text code>{record.component.config_version}</Text>
              ) : (
                <Text type="secondary">-</Text>
              ),
          },
          {
            title: '最近错误',
            key: 'component-last-error',
            render: (_: unknown, record: { agent: EdgeAgent; component: EdgeComponent }) =>
              record.component.last_error ? (
                <Tooltip title={record.component.last_error}>
                  <Text type="danger" ellipsis style={{ maxWidth: 200 }}>
                    {record.component.last_error}
                  </Text>
                </Tooltip>
              ) : (
                <Text type="secondary">-</Text>
              ),
          },
        ]}
      />
    )
  }

  const filterBar = multiSite ? (
    <Space wrap>
      <Space>
        <Text type="secondary">选择网域：</Text>
        <Select
          allowClear
          placeholder="全部网域"
          style={{ width: 220 }}
          value={selectedDomain}
          onChange={(v) => setSelectedDomain(v)}
          options={networkDomains
            .filter((d) => edgeAgents.some((a) => a.network_domain_id === d.id))
            .map((d) => ({ value: d.id, label: `${d.name}（${d.id}）` }))}
        />
      </Space>
      <Space>
        <Text type="secondary">组件类型：</Text>
        <Select
          allowClear
          placeholder="全部组件"
          style={{ width: 200 }}
          value={selectedComponentType}
          onChange={(v) => setSelectedComponentType(v)}
          options={(Object.keys(componentTypeLabel) as EdgeComponentType[]).map((t) => ({
            value: t,
            label: componentTypeLabel[t],
          }))}
        />
      </Space>
    </Space>
  ) : undefined

  return (
    <MainLayout>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic title="有 Agent 网域数" value={stats.domainTotal} />
          </Card>
        </Col>
        {(!selectedComponentType || selectedComponentType === 'edge_sync_agent') && (
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="在线 Agent（边缘节点）" value={stats.syncOnline} valueStyle={{ color: '#00B578' }} />
            </Card>
          </Col>
        )}
        {(!selectedComponentType || selectedComponentType === 'collector') && (
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="采集器运行中" value={stats.collectorRunning} valueStyle={{ color: '#00B578' }} />
            </Card>
          </Col>
        )}
        {(!selectedComponentType || selectedComponentType === 'blackbox_exporter') && (
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic title="拨测器运行中" value={stats.blackboxRunning} valueStyle={{ color: '#0ECDEB' }} />
            </Card>
          </Col>
        )}
      </Row>

      <Card
        title={
          <Space size={4}>
            边缘 Agent 状态（网域为主 + 组件分类）
            <Tooltip title="仅展示部署了 Edge Agent 的网域（default 管理域中心直接采集、无边缘 Agent）；一级表格按网域聚合，展开行按组件类型分类展示组件实例；支持按网域与组件类型双筛选（联动明细与统计卡）">
              <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
            </Tooltip>
          </Space>
        }
        extra={filterBar}
      >
        {!multiSite ? (
          <Alert
            type="info"
            showIcon
            message="单网域模式不展示 Agent 状态"
            description="default 管理域由中心直接采集，不部署 Edge Agent；请切换为多网域模式（Tenant.multi_site_enabled=true）后查看边缘 Agent 状态。"
          />
        ) : rows.length === 0 ? (
          <Empty description="当前筛选条件下无部署 Edge Agent 的网域" />
        ) : (
          <>
            <Table
              dataSource={rows}
              rowKey="key"
              size="small"
              pagination={{ pageSize: 10 }}
              expandable={{
                expandedRowRender: (record) => renderComponentRows(record.agents),
                rowExpandable: (record) => record.agentsTotal > 0,
              }}
              columns={[
                {
                  title: '网域',
                  key: 'domain',
                  render: (_: unknown, record: DomainAggRow) => (
                    <Space direction="vertical" size={2}>
                      <Space size={6}>
                        <Text strong>{record.domainName}</Text>
                        <Tag color={record.domainType === 'management' ? 'blue' : 'cyan'}>
                          {record.domainType === 'management' ? '管理域' : '边缘域'}
                        </Tag>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {record.domainId}
                      </Text>
                    </Space>
                  ),
                },
                {
                  title: (
                    <Tooltip title="该网域下 Edge Sync Agent（边缘节点）在线数 / 总数">
                      <Space size={4}>
                        在线 Agent
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'sync-online',
                  render: (_: unknown, record: DomainAggRow) => (
                    <Tag
                      color={record.syncOnline === record.agentsTotal && record.agentsTotal > 0 ? 'success' : 'warning'}
                    >
                      {record.syncOnline}/{record.agentsTotal}
                    </Tag>
                  ),
                },
                {
                  title: (
                    <Tooltip title="指标采集器（vmagent / prometheus-agent）运行中数 / 总数（采集器进程管理）；组件类型筛选后仅统计匹配类型">
                      <Space size={4}>
                        采集器
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'collector',
                  render: (_: unknown, record: DomainAggRow) =>
                    record.collectorTotal > 0 ? (
                      <Tag color={record.collectorRunning === record.collectorTotal ? 'success' : 'error'}>
                        {record.collectorRunning}/{record.collectorTotal} 运行中
                      </Tag>
                    ) : (
                      <Text type="secondary">-</Text>
                    ),
                },
                {
                  title: (
                    <Tooltip title="拨测器（blackbox exporter）运行中数 / 总数；未部署表示该网域无 job_type=blackbox 的 ScrapeJob；组件类型筛选后仅统计匹配类型">
                      <Space size={4}>
                        拨测器
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'blackbox',
                  render: (_: unknown, record: DomainAggRow) =>
                    record.blackboxTotal > 0 ? (
                      <Tag color={record.blackboxRunning === record.blackboxTotal ? 'success' : 'error'}>
                        {record.blackboxRunning}/{record.blackboxTotal} 运行中
                      </Tag>
                    ) : (
                      <Text type="secondary">未部署</Text>
                    ),
                },
                {
                  title: (
                    <Tooltip title="该网域下配置未同步（out_of_sync / manual_override）的 Agent 数（配置同步状态）">
                      <Space size={4}>
                        配置同步
                        <QuestionCircleOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />
                      </Space>
                    </Tooltip>
                  ),
                  key: 'config-sync',
                  render: (_: unknown, record: DomainAggRow) =>
                    record.outOfSyncCount > 0 ? (
                      <Tag color="warning">{record.outOfSyncCount} 未同步</Tag>
                    ) : (
                      <Tag color="success">已同步</Tag>
                    ),
                },
                {
                  title: 'WAL 积压（合计）',
                  key: 'wal',
                  render: (_: unknown, record: DomainAggRow) => (
                    <Text>{record.walSum > 0 ? formatBytes(record.walSum) : '0 B'}</Text>
                  ),
                },
                {
                  title: '最后心跳',
                  key: 'last-heartbeat',
                  render: (_: unknown, record: DomainAggRow) => <Text>{record.lastHeartbeat}</Text>,
                },
                {
                  title: '操作',
                  key: 'action',
                  render: (_: unknown, record: DomainAggRow) => (
                    <Space>
                      <Tooltip title={`${domainMap[record.domainId] ?? record.domainId}：展开查看组件明细`}>
                        <ReloadOutlined style={{ color: '#0ECDEB', cursor: 'pointer' }} />
                      </Tooltip>
                    </Space>
                  ),
                },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                展示范围：仅展示部署了 Edge Agent 的网域——default 管理域由中心直接采集、不部署 Edge Agent，
                不出现在本页；多网域模式下按「网域 + 组件类型」双筛选，组件类型筛选联动统计卡与展开明细，一级表对应列仅统计匹配类型组件。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                展示结构：一级表格按网域聚合（在线 Agent / 采集器运行中 / 拨测器运行中 / 配置同步 / WAL 合计），
                展开行按组件类型分类展示该网域全部组件实例——Edge Sync Agent（必装独立组件，负责心跳 / 配置拉取 / 控制本节点组件）、
                指标采集器（vmagent / prometheus-agent 二选一）、拨测器（blackbox exporter，可选，blackbox job 网域附带）、
                v0.4+ 边缘告警组件（vmalert / alertmanager）。组件清单由 Edge Sync Agent 心跳附带上报，展示对象为边缘节点 Agent 部署实例（= Edge Sync Agent + 采集器组合）。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                配置同步状态说明：<Text code>in_sync</Text>=已同步（中心与边缘版本一致）；
                <Text code>out_of_sync</Text>=未同步（中心有更新版本，或边缘拉取配置包后 checksum 校验失败保留旧配置）；
                <Text code>manual_override</Text>=本地手工覆盖（平台不强制 reconcile，需人工重新确认下发）；
                <Text code>unknown</Text>=未知（未上报配置版本）。Agent IP / 主机名由 Edge Sync Agent 心跳上报登记，仅展示，不参与配置下发。
              </Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                边缘传输校验：Edge Sync Agent 拉包后按{' '}
                <Text code>metadata.json</Text> 联合 checksum 做完整性校验，解压后对{' '}
                <Text code>targets/*.json</Text> 做解析校验（JSON 结构、targets / labels 字段合法性），失败保留最后一份有效配置并记录错误，体现为{' '}
                <Text code>config_sync_status</Text> 异常态（out_of_sync / manual_override）；Agent 为「哑校验」，不做 promtool 级语法校验，产物合法性由中心内容校验（validation_status）保证。
              </Text>
              <br />
              {/* {v1.28} 断网自治说明：断网不影响中心草稿/版本持久化，边缘保留最后有效配置自治，恢复后拉最新已审批版本 */}
              <Text type="secondary" style={{ fontSize: 12 }}>
                断网自治（{`{v1.28}`}）：断网期间配置草稿 / 版本在中心正常生成与存储（不影响发布流程）；
                边缘 Agent 保留<Text strong>最后一份有效配置</Text>继续自治采集（本地快照，不依赖中心在线），
                网络恢复后心跳上报配置版本 → 中心响应有更新 → 拉取该网域最新已审批版本（网域内版本一致 + checksum 校验）。
              </Text>
            </div>
          </>
        )}
      </Card>
    </MainLayout>
  )
}

export default EdgeAgentsPage
