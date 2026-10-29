/**
 * 告警状态页（Module_08 v1.12 MVP 增量 §5.4，双视图）。
 * 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
 * 与 docs/05-execution-records/module-08/api-contract-snapshot.md §10。
 * Tab 1「当前告警」：event 表未结三态（告警中 / 静默中 / 抑制中），与历史告警、
 *   首页四格同一张表、同一套状态词；取消 AM notify_status 四态，「待处理」不再展示。
 * Tab 2「规则评估」：Prometheus firing=触发中 / pending=观察中（M02 代理 /api/v1/alerts）。
 * 页签名友好化（用户反馈 2026-09-11）：不再用「Alertmanager / Prometheus」技术组件名做页签，
 * 两视图语义区分由折叠栏 + 页签 hover 提示承载（原引导语「两个页签分别看什么？」已更换措辞）；
 * 页头独立标题卡片移除（用户第二轮反馈：截图中顶部大标题 Card 不要）。
 * 裁剪：原型「接收人」列无 AM v2 数据源，不做（frontend-prototype-map §8.4）。
 */
import { useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  Button,
  Card,
  Collapse,
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
  FireOutlined,
  InfoCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { FilterBar, FilterItem } from '../../components/FilterBar'
import { EllipsisText } from '../../components/EllipsisText'
import { RuleGuideEmpty } from '../../components/RuleGuideLink'
import { TABLE_PAGINATION, TABLE_SCROLL_X } from '../../components/tablePresets'
import { MainLayout } from '../../layouts/MainLayout'
import { useSkin } from '../../skinContext'
import type { AlertEventItem, AlertEventStatus, PromAlertItem, PromAlertState } from '../../types/alertmanager'
import {
  alertEventStatusColor,
  alertEventStatusLabel,
  promAlertStateColor,
  promAlertStateLabel,
} from './alertmanagerConstants'
import {
  CURRENT_ALERTS_PAGE_SIZE,
  useCurrentAlerts,
  useNetworkDomains,
  useOpenAlertStats,
  usePromAlerts,
  type AlertViewState,
  type CurrentAlertStatusFilter,
  type DomainOption,
  type OpenAlertStats,
  type OpenAlertStatus,
} from './useAlertStatus'

const { Text } = Typography

/** 未结三态展示顺序 / 图标（图标不下沉 constants 以保持其为纯 ts 文件） */
const OPEN_STATUS_ORDER: OpenAlertStatus[] = ['firing', 'silenced', 'inhibited']

const OPEN_STATUS_ICON: Record<OpenAlertStatus, ReactNode> = {
  firing: <FireOutlined />,
  silenced: <PauseCircleOutlined />,
  inhibited: <ThunderboltOutlined />,
}

/** 未结三态语义说明（统计卡片 Tooltip） */
const OPEN_STATUS_TIP: Record<OpenAlertStatus, string> = {
  firing: '告警已触发、正在通知，且未被静默或抑制',
  silenced: '告警已触发，但被静默规则命中，通知被屏蔽',
  inhibited: '告警已触发，但被更高级别的根因告警抑制，通知不重复发送',
}

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
 * 网域展示名：优先生成期注入的中文展示标签 network_domain_name；
 * 存量告警无该标签时按网域 ID 映射 M06 网域名称，字典未命中回退 ID。
 * 过滤仍以 labels.network_domain 的 ID 为准，本函数只负责展示。
 */
function domainNameOf(item: { labels: Record<string, string> }, domains: DomainOption[]): string {
  const display = item.labels['network_domain_name']
  if (display) return display
  const id = item.labels['network_domain']
  if (!id) return '-'
  return domains.find((d) => d.id === id)?.name ?? id
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

/** 未结三态统计卡片（与列表 status=open 同源；统计失败显示 '-'，不把失败静默成 0） */
function OpenStatusStats({ stats, loading }: { stats: OpenAlertStats | null; loading: boolean }) {
  // 语义红走皮肤 token（单一来源，见 skins.ts 设计约束）
  const { tokens } = useSkin()
  return (
    <Row gutter={16} style={{ marginBottom: 16 }}>
      {OPEN_STATUS_ORDER.map((key) => (
        <Col span={8} key={key}>
          <Card size="small" loading={loading}>
            <Tooltip title={OPEN_STATUS_TIP[key]}>
              <Statistic
                title={
                  <Space size={4}>
                    {OPEN_STATUS_ICON[key]}
                    <span>{alertEventStatusLabel[key]}</span>
                  </Space>
                }
                value={stats ? stats[key] : '-'}
                valueStyle={{ fontSize: 22, color: key === 'firing' ? tokens.colorError : undefined }}
              />
            </Tooltip>
          </Card>
        </Col>
      ))}
    </Row>
  )
}

/** 历史告警事件的网域展示名：优先注入标签，缺失按网域 ID 映射 M06 名称 */
function eventDomainNameOf(item: AlertEventItem, domains: DomainOption[]): string {
  const display = item.labels?.['network_domain_name']
  if (display) return display
  const id = item.network_domain || item.labels?.['network_domain']
  if (!id) return '-'
  return domains.find((d) => d.id === id)?.name ?? id
}

/** 未结状态 Tag（列表列）；非未结态不会出现在本页，类型上仍做防御性渲染 */
function OpenStatusTag({ status }: { status: AlertEventStatus }) {
  if (status !== 'firing' && status !== 'silenced' && status !== 'inhibited') {
    return <Tag color={alertEventStatusColor[status]}>{alertEventStatusLabel[status]}</Tag>
  }
  return (
    <Tooltip title={OPEN_STATUS_TIP[status]}>
      <Tag color={alertEventStatusColor[status]} icon={OPEN_STATUS_ICON[status]}>
        {alertEventStatusLabel[status]}
      </Tag>
    </Tooltip>
  )
}

/** Tab 1：当前告警视图（event 表未结三态；状态 / 网域筛选与分页均由服务端承担） */
function CurrentAlertsView({
  domain,
  onDomainChange,
  domains,
  stats,
  statsLoading,
  statsError,
  onReloadStats,
}: {
  domain: string
  onDomainChange: (v: string) => void
  domains: DomainOption[]
  stats: OpenAlertStats | null
  statsLoading: boolean
  statsError: string | null
  onReloadStats?: () => void
}) {
  const [statusFilter, setStatusFilter] = useState<CurrentAlertStatusFilter>('all')
  const query = useMemo(
    () => ({ networkDomain: domain, status: statusFilter, page: 1, pageSize: CURRENT_ALERTS_PAGE_SIZE }),
    [domain, statusFilter],
  )
  const state = useCurrentAlerts(query)

  // 筛选变化后回到第 1 页；setPage 与筛选 setState 同批处理，只触发一次请求。
  const handleStatusChange = (v: CurrentAlertStatusFilter) => {
    setStatusFilter(v)
    state.setPage(1)
  }
  const handleDomainChange = (v: string) => {
    onDomainChange(v)
    state.setPage(1)
  }

  const columns: ColumnsType<AlertEventItem> = [
    {
      title: '告警名称',
      dataIndex: 'alert_name',
      key: 'alert_name',
      width: 180,
      fixed: 'left',
      render: (v: string) => <EllipsisText maxWidth={160}>{v || '-'}</EllipsisText>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v: AlertEventStatus) => <OpenStatusTag status={v} />,
    },
    {
      title: '网域',
      key: 'network_domain',
      width: 110,
      render: (_, r) => <Text>{eventDomainNameOf(r, domains)}</Text>,
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
      render: (v?: string) => <Text>{formatTime(v)}</Text>,
    },
    {
      title: '摘要',
      key: 'summary',
      render: (_, r) => <EllipsisText maxWidth={240}>{r.summary || '-'}</EllipsisText>,
    },
  ]

  if (state.permissionDenied) {
    return (
      <Card>
        <Empty description="当前账号无此页面查看权限" />
      </Card>
    )
  }

  const emptyText = state.loading ? (
    '加载中…'
  ) : state.error ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
  ) : state.total === 0 ? (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前无告警" />
  ) : (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配告警" />
  )

  return (
    <>
      <OpenStatusStats stats={stats} loading={statsLoading} />
      {statsError && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="未结计数加载失败，卡片显示 -"
          description={statsError}
        />
      )}
      {state.error && <ViewError error={state.error} onReload={state.reload} />}
      <FilterBar>
        <FilterItem label="状态">
          <Select
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(v) => handleStatusChange(v as CurrentAlertStatusFilter)}
            options={[
              { value: 'all', label: '全部' },
              ...OPEN_STATUS_ORDER.map((s) => ({ value: s, label: alertEventStatusLabel[s] })),
            ]}
          />
        </FilterItem>
        <DomainFilter value={domain} onChange={handleDomainChange} domains={domains} />
        <FilterItem label="操作">
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              state.reload()
              onReloadStats?.()
            }}
            loading={state.loading}
          >
            刷新
          </Button>
        </FilterItem>
      </FilterBar>
      <Table<AlertEventItem>
        rowKey="id"
        dataSource={state.items}
        loading={state.loading}
        columns={columns}
        scroll={TABLE_SCROLL_X}
        pagination={{
          ...TABLE_PAGINATION,
          current: state.page,
          pageSize: state.pageSize,
          total: state.total,
          onChange: (p, ps) => {
            if (ps !== state.pageSize) state.setPageSize(ps)
            else state.setPage(p)
          },
        }}
        locale={{ emptyText }}
      />
    </>
  )
}

/** Tab 2：Prometheus 规则评估视图（firing=触发中 / pending=观察中；契约 §10.1） */
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
      render: (_, r) => <Text>{domainNameOf(r, domains)}</Text>,
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
        /* PL-1（D-1 方案丙）：当前告警为空且无错误时补「去写规则」引导——告警为空最常见的
           原因是还没有告警规则；引导指向 M01「规则编辑」/rules（与 M09 空态引导同构，复用共享组件）。
           错误态不展示引导（不把失败伪装成无数据）；筛选后无匹配也不展示（并非没有规则）。 */
        locale={{
          emptyText: state.loading ? (
            '加载中…'
          ) : state.error ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
          ) : state.items.length === 0 ? (
            <RuleGuideEmpty description="当前无触发中的告警" />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配告警" />
          ),
        }}
      />
    </>
  )
}

export function AlertStatusPage() {
  const { tokens } = useSkin()
  const [tab, setTab] = useState<'current' | 'rules'>('current')
  // 网域筛选两视图共享（'all' = 不传参）；过滤由后端承担（Query 透传，前端不重复过滤）
  const [domain, setDomain] = useState<string>('all')
  const domainParam = domain === 'all' ? undefined : domain
  const prom = usePromAlerts(domainParam)
  const stats = useOpenAlertStats(domainParam)
  const domains = useNetworkDomains()

  // 权限不足：规则评估视图 403 即整页空态；当前告警视图在组件内单独处理 403
  // （两视图均命中认证中间件，MVP 单租户恒通过）。
  if (prom.permissionDenied) {
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
        {/* 页头不带独立标题卡片（用户反馈 2026-09-11：顶部大标题 Card 移除，侧栏菜单已含页名）。
            两视图语义差异保留折叠栏指引：默认收起（用户第三轮反馈），内容口语化、三行格式统一，
            页签收敛为「当前告警 / 规则评估」（2026-10-29 event 表单一事实源）。 */}
        <Collapse
          ghost
          size="small"
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'view-guide',
              label: (
                <Space size={8}>
                  <InfoCircleOutlined style={{ color: tokens.colorInfo }} />
                  <Text strong>「当前告警」和「规则评估」有什么区别？</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    点击展开说明
                  </Text>
                </Space>
              ),
              children: (
                <div>
                  <Text>
                    <strong>「当前告警」= 现在有哪些问题：</strong>
                    告警中：已触发且正在通知；静默中：被静默规则命中，通知被屏蔽；抑制中：被更高级别的根因告警抑制，不重复通知。数据来自平台告警事件表，与「历史告警」、首页统计同源。
                  </Text>
                  <br />
                  <Text>
                    <strong>「规则评估」= 规则算出来什么：</strong>
                    触发中：条件已满足并持续到 for 时长；观察中：条件刚满足，仍在 for 观察期，暂未触发。
                  </Text>
                  <br />
                  <Text>
                    <strong>说明：</strong>这里只显示你有权限查看的网域。
                  </Text>
                </div>
              ),
            },
          ]}
        />

        <Card>
          <Tabs
            activeKey={tab}
            onChange={(k) => setTab(k as 'current' | 'rules')}
            items={[
              {
                key: 'current',
                label: <Tooltip title="现在有哪些告警（含静默、抑制）">当前告警</Tooltip>,
                children: (
                  <CurrentAlertsView
                    domain={domain}
                    onDomainChange={setDomain}
                    domains={domains}
                    stats={stats.stats}
                    statsLoading={stats.loading}
                    statsError={stats.error}
                    onReloadStats={stats.reload}
                  />
                ),
              },
              {
                key: 'rules',
                label: <Tooltip title="告警规则表达式的当前求值结果">规则评估</Tooltip>,
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
