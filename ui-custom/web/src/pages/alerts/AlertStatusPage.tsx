/**
 * 告警状态页（Module_08 v1.12 MVP 增量 §5.4，双视图）。
 * 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
 * 与 docs/05-execution-records/module-08/api-contract-snapshot.md §10。
 * Tab 1「Alertmanager 通知状态」：四态（通知中/已静默/已抑制/待处理，服务端归一 notify_status）；
 * Tab 2「Prometheus 当前触发告警」：firing=触发中 / pending=待处理（M02 代理 /api/v1/alerts）。
 * 裁剪：原型「接收人」列无 AM v2 数据源，不做（frontend-prototype-map §8.4）。
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  Empty,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import config from 'antd/locale/zh_CN'
import {
  ClockCircleOutlined,
  FireOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import type { AmAlertItem, NotifyStatus, PromAlertItem, PromAlertState } from '../../types/alertmanager'
import {
  notifyStatusColor,
  notifyStatusLabel,
  notifyStatusTip,
  promAlertStateColor,
  promAlertStateLabel,
} from './alertmanagerConstants'
import { useAmAlerts, useNetworkDomains, usePromAlerts, type AlertViewState, type DomainOption } from './useAlertStatus'

const { Text } = Typography

/** 四态统计卡片图标（语义与原型一致；图标不下沉 constants 以保持其为纯 ts 文件） */
const NOTIFY_STATUS_ICON: Record<NotifyStatus, ReactNode> = {
  active: <FireOutlined />,
  silenced: <PauseCircleOutlined />,
  inhibited: <ThunderboltOutlined />,
  unprocessed: <ClockCircleOutlined />,
}

const NOTIFY_STATUS_ORDER: NotifyStatus[] = ['active', 'silenced', 'inhibited', 'unprocessed']

/** 时间展示：ISO 转本地可读串（复用全仓既时区展示约定，不引入新依赖） */
function formatTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { hour12: false })
}

/** 告警标签读取（缺失标签回落：network_domain 缺失按契约回落 default 由后端承担，前端兜底 '-'） */
function labelOf(item: { labels: Record<string, string> }, key: string): string {
  return item.labels[key] || '-'
}

/**
 * 实例名展示（M08 v1.15 决策 70）：M01 资源清单口径，由后端按告警标签 resource_id
 * 回连资源表回填。无 resource_id（拨测 / 聚合 / 自写规则）时显示 '-'——
 * **不回落成地址**，否则与「采集地址」列同值，复刻旧毛病。
 */
function instanceNameOf(item: { resource_name?: string }): string {
  return item.resource_name || '-'
}

/**
 * 采集地址展示（原「实例」列的取值）：优先后端语义化字段 instance_address，
 * 回落兼容字段 instance_display，再回落常见标签键；聚合 / 全局告警显示「全局/聚合」。
 */
function instanceAddressOf(item: {
  labels?: Record<string, string>
  instance_address?: string
  instance_display?: string
}): string {
  if (item.instance_address) return item.instance_address
  if (item.instance_display) return item.instance_display
  const keys = ['instance', 'instance_ip', 'service_name', 'nodename', 'device']
  for (const k of keys) {
    const v = item.labels?.[k]
    if (v) return v
  }
  return '全局/聚合'
}

/** 「采集地址」列表头：挂提示直接消解 `:9100`（exporter 端口）被误读为业务端口 */
function InstanceAddressTitle() {
  return (
    <span>
      采集地址
      <Tooltip title="采集器地址，非业务端口（如 :9100 为 exporter 监听端口，不是您填写的业务端口）">
        <InfoCircleOutlined style={{ marginLeft: 4, color: 'rgba(0,0,0,0.35)', fontSize: 12 }} />
      </Tooltip>
    </span>
  )
}

/** 告警当前值展示：科学计数法转可读数值，保留原始字符串兜底 */
function formatAlertValue(v?: string): string {
  if (!v) return '-'
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  // 大数 / 小数科学计数法转普通表示，最多 6 位有效数字
  if (Math.abs(n) >= 1e6 || (Math.abs(n) > 0 && Math.abs(n) < 1e-3)) {
    return n.toPrecision(4).replace(/\.?0+e/, 'e')
  }
  // 整数直接展示，小数保留 4 位有效数字
  if (Number.isInteger(n)) return n.toString()
  return n.toPrecision(4).replace(/\.?0+$/, '')
}

/** 视图内错误提示（接口错误态：错误 Alert + 重试入口） */
function ViewError({ error, onReload }: { error: string; onReload: () => void }) {
  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message="告警列表加载失败，请稍后重试"
      description={error}
      action={
        <Button size="small" onClick={onReload}>
          重新加载
        </Button>
      }
    />
  )
}

/** 网域筛选下拉（两视图共用；选项来自 M06 网域管理，与 TargetStatusPage 同构） */
function DomainFilter({
  value,
  onChange,
  domains,
}: {
  value: string
  onChange: (v: string) => void
  domains: DomainOption[]
}) {
  return (
    <FilterItem label="网域">
      <Select
        style={{ width: 200 }}
        value={value}
        onChange={onChange}
        options={[{ value: 'all', label: '全部网域' }, ...domains.map((d) => ({ value: d.id, label: d.name }))]}
      />
    </FilterItem>
  )
}

/** AM 通知状态四态统计卡片（原型 AlertStatusPage 对齐，视觉 Token 沿用全站） */
function NotifyStatusStats({ items }: { items: AmAlertItem[] }) {
  const counts = useMemo(() => {
    const counter: Record<NotifyStatus, number> = { active: 0, silenced: 0, inhibited: 0, unprocessed: 0 }
    items.forEach((a) => {
      if (a.notify_status in counter) counter[a.notify_status] += 1
    })
    return counter
  }, [items])
  return (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      {NOTIFY_STATUS_ORDER.map((key) => (
        <Col span={6} key={key}>
          <Card size="small">
            <Tooltip title={notifyStatusTip[key]}>
              <Statistic
                title={
                  <Space size={4}>
                    {NOTIFY_STATUS_ICON[key]}
                    <span>{notifyStatusLabel[key]}</span>
                  </Space>
                }
                value={counts[key]}
                valueStyle={{ fontSize: 22, color: key === 'active' ? '#FF4C3A' : undefined }}
              />
            </Tooltip>
          </Card>
        </Col>
      ))}
    </Row>
  )
}

/** Tab 1：Alertmanager 通知状态视图（四态；列集合对照 frontend-prototype-map §8.2，无「接收人」列） */
function AmAlertsView({
  state,
  domain,
  onDomainChange,
  domains,
}: {
  state: AlertViewState<AmAlertItem>
  domain: string
  onDomainChange: (v: string) => void
  domains: DomainOption[]
}) {
  const [statusFilter, setStatusFilter] = useState<NotifyStatus | 'all'>('all')

  // 状态筛选为客户端过滤（契约未提供服务端状态过滤参数，仅 network_domain 透传后端）
  const filtered = useMemo(
    () => state.items.filter((a) => statusFilter === 'all' || a.notify_status === statusFilter),
    [state.items, statusFilter],
  )

  const columns: ColumnsType<AmAlertItem> = [
    {
      title: '告警名称',
      key: 'alertname',
      width: 180,
      fixed: 'left',
      render: (_, r) => <EllipsisText maxWidth={160}>{labelOf(r, 'alertname')}</EllipsisText>,
    },
    {
      title: '通知状态',
      dataIndex: 'notify_status',
      key: 'notify_status',
      width: 110,
      render: (v: NotifyStatus) => (
        <Tooltip title={notifyStatusTip[v]}>
          <Tag color={notifyStatusColor[v]} icon={NOTIFY_STATUS_ICON[v]}>
            {notifyStatusLabel[v]}
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: '网域',
      key: 'network_domain',
      width: 110,
      render: (_, r) => <Text>{labelOf(r, 'network_domain')}</Text>,
    },
    {
      title: '实例名',
      key: 'resource_name',
      width: 150,
      render: (_, r) => <EllipsisText maxWidth={130}>{instanceNameOf(r)}</EllipsisText>,
    },
    {
      title: <InstanceAddressTitle />,
      key: 'instance_address',
      width: 170,
      render: (_, r) => <EllipsisText maxWidth={150}>{instanceAddressOf(r)}</EllipsisText>,
    },
    {
      title: '开始时间',
      dataIndex: 'starts_at',
      key: 'starts_at',
      width: 170,
      render: (v: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '摘要',
      key: 'summary',
      render: (_, r) => <EllipsisText maxWidth={240}>{r.annotations?.summary || '-'}</EllipsisText>,
    },
  ]

  return (
    <>
      {state.error && <ViewError error={state.error} onReload={state.reload} />}
      <NotifyStatusStats items={state.items} />
      <FilterBar>
        <FilterItem label="通知状态">
          <Select
            style={{ width: 160 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部' },
              ...NOTIFY_STATUS_ORDER.map((s) => ({ value: s, label: notifyStatusLabel[s] })),
            ]}
          />
        </FilterItem>
        <DomainFilter value={domain} onChange={onDomainChange} domains={domains} />
        <FilterItem label="操作">
          <Button icon={<ReloadOutlined />} onClick={state.reload} loading={state.loading}>
            刷新
          </Button>
        </FilterItem>
      </FilterBar>
      <Table<AmAlertItem>
        rowKey={(r) => `${labelOf(r, 'alertname')}|${r.resource_id || instanceAddressOf(r)}|${r.starts_at}`}
        dataSource={filtered}
        loading={state.loading}
        columns={columns}
        scroll={TABLE_SCROLL_X}
        pagination={TABLE_PAGINATION}
      />
    </>
  )
}

/** Tab 2：Prometheus 当前触发告警视图（firing=触发中 / pending=待处理；契约 §10.1） */
function PromAlertsView({
  state,
  domain,
  onDomainChange,
  domains,
}: {
  state: AlertViewState<PromAlertItem>
  domain: string
  onDomainChange: (v: string) => void
  domains: DomainOption[]
}) {
  const [stateFilter, setStateFilter] = useState<PromAlertState | 'all'>('all')

  const filtered = useMemo(
    () => state.items.filter((a) => stateFilter === 'all' || a.state === stateFilter),
    [state.items, stateFilter],
  )

  const columns: ColumnsType<PromAlertItem> = [
    {
      title: '告警名称',
      key: 'alertname',
      width: 180,
      fixed: 'left',
      render: (_, r) => <EllipsisText maxWidth={160}>{labelOf(r, 'alertname')}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 100,
      render: (v: PromAlertState) => <Tag color={promAlertStateColor[v]}>{promAlertStateLabel[v]}</Tag>,
    },
    {
      title: '网域',
      key: 'network_domain',
      width: 110,
      render: (_, r) => <Text>{labelOf(r, 'network_domain')}</Text>,
    },
    {
      title: '实例名',
      key: 'resource_name',
      width: 150,
      render: (_, r) => <EllipsisText maxWidth={130}>{instanceNameOf(r)}</EllipsisText>,
    },
    {
      title: <InstanceAddressTitle />,
      key: 'instance_address',
      width: 170,
      render: (_, r) => <EllipsisText maxWidth={150}>{instanceAddressOf(r)}</EllipsisText>,
    },
    {
      title: '激活时间',
      dataIndex: 'activeAt',
      key: 'activeAt',
      width: 170,
      render: (v: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '摘要',
      key: 'summary',
      render: (_, r) => <EllipsisText maxWidth={220}>{r.annotations?.summary || '-'}</EllipsisText>,
    },
    {
      title: '当前值',
      dataIndex: 'value',
      key: 'value',
      width: 110,
      render: (v?: string) => <Text code>{formatAlertValue(v)}</Text>,
    },
  ]

  return (
    <>
      {state.error && <ViewError error={state.error} onReload={state.reload} />}
      <FilterBar>
        <FilterItem label="状态">
          <Select
            style={{ width: 160 }}
            value={stateFilter}
            onChange={setStateFilter}
            options={[
              { value: 'all', label: '全部' },
              { value: 'firing', label: promAlertStateLabel.firing },
              { value: 'pending', label: promAlertStateLabel.pending },
            ]}
          />
        </FilterItem>
        <DomainFilter value={domain} onChange={onDomainChange} domains={domains} />
        <FilterItem label="操作">
          <Button icon={<ReloadOutlined />} onClick={state.reload} loading={state.loading}>
            刷新
          </Button>
        </FilterItem>
      </FilterBar>
      <Table<PromAlertItem>
        rowKey={(r) => `${labelOf(r, 'alertname')}|${r.resource_id || instanceAddressOf(r)}|${r.activeAt}`}
        dataSource={filtered}
        loading={state.loading}
        columns={columns}
        scroll={TABLE_SCROLL_X}
        pagination={TABLE_PAGINATION}
      />
    </>
  )
}

export function AlertStatusPage() {
  const [tab, setTab] = useState<'am' | 'prom'>('am')
  // 网域筛选两视图共享（'all' = 不传参）；过滤由后端承担（Query 透传，前端不重复过滤）
  const [domain, setDomain] = useState<string>('all')
  const domainParam = domain === 'all' ? undefined : domain
  const am = useAmAlerts(domainParam)
  const prom = usePromAlerts(domainParam)
  const domains = useNetworkDomains()

  // 权限不足：任一视图 403 即整页空态（两视图均命中认证中间件，MVP 单租户恒通过）
  if (am.permissionDenied || prom.permissionDenied) {
    return (
      <MainLayout>
        <Card>
          <Empty description="当前账号无此页面查看权限" />
        </Card>
      </MainLayout>
    )
  }

  return (
    <MainLayout>
      <ConfigProvider locale={config}>
        <Card style={{ marginBottom: 16 }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            告警状态
          </Typography.Title>
          <Text type="secondary">
            双视图查看当前告警：Alertmanager 通知状态（谁正在被通知）与 Prometheus 当前触发告警（哪些规则被触发）；
            通知状态已按授权网域集合过滤（授权 = 全部网域时不附加过滤）
          </Text>
        </Card>

        {/* PRD §3.2：两视图语义差异用说明文案明确区分 */}
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="两个视图的语义区别"
          description={
            <span>
              <strong>「Prometheus 当前触发告警」</strong>回答「什么出了问题」：展示告警规则实时求值结果
              （触发中 = 规则已满足条件、待处理 = 规则满足条件但未达持续时间）。
              <br />
              <strong>「Alertmanager 通知状态」</strong>回答「通知是否已发出/被收敛」：展示告警经过路由、静默、
              抑制后的处理结果（通知中 / 已静默 / 已抑制 / 待处理）。
              同一告警在两个视图中的含义不同，请按排查目标切换。
            </span>
          }
        />

        <Card>
          <Tabs
            activeKey={tab}
            onChange={(k) => setTab(k as 'am' | 'prom')}
            items={[
              {
                key: 'am',
                label: (
                  <Tooltip title="告警经路由/静默/抑制后的通知处理结果">
                    Alertmanager 通知状态
                  </Tooltip>
                ),
                children: <AmAlertsView state={am} domain={domain} onDomainChange={setDomain} domains={domains} />,
              },
              {
                key: 'prom',
                label: (
                  <Tooltip title="Prometheus 告警规则实时求值结果">
                    Prometheus 当前触发告警
                  </Tooltip>
                ),
                children: <PromAlertsView state={prom} domain={domain} onDomainChange={setDomain} domains={domains} />,
              },
            ]}
          />
        </Card>
      </ConfigProvider>
    </MainLayout>
  )
}

export default AlertStatusPage
