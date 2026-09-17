/**
 * 首页概览（Module_05 §3.1「首页（MVP 子集）交互契约」决策 72 / 72-1 / 72-2 / 72-3）。
 *
 * 页面结构（自上而下，决策 72-2 / 72-3）：
 * 标题区 → 关键指标卡网格（6 张资产与治理进度卡，含口径注释）→
 * 告警治理态大卡片（首页唯一告警入口）+ 快捷入口 / 最近下发 → 使用指引。
 *
 * 数据源（决策 72-3 放宽「零后端改动」，见
 * docs/05-execution-records/module-05/design-proposals/homepage-mvp-content-restructure.md）：
 * - dashboardApi.getSummary()：资源总数 / 已监控 / 采集 Job / 已纳管网域 / 待确认草稿 / 最近下发；
 *   「采集覆盖率」由 已监控 ÷ 资源总数 前端派生；
 * - alertStatusApi（AM 通知四态 + Prom 触发态）**单次请求**由 useAlertGovernance 持有：
 *   告警数字与最新 5 条告警同源，不重复取数；指标卡**不再出现任何告警数字**。
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Badge, Col, Row, Space, Table, Tooltip, Typography, theme } from 'antd'
import type { BadgeProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ClusterOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  MonitorOutlined,
  PieChartOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import { apiClient } from '../../api/client'
import { dashboardApi } from '../../api/dashboard'
import type { DashboardSummary, RecentDeployment } from '../../api/dashboard'
import { alertStatusApi } from '../../api/alertmanager'
import type { AmAlertItem, AmAlertsData, PromAlertItem, PromAlertsData } from '../../types/alertmanager'
import type { ApiResponse } from '../../types/api'
import {
  deploymentStatusColor,
  deploymentStatusLabel,
} from '../config-center/configCenterConstants'
import { MainLayout } from '../../layouts/MainLayout'
import { EllipsisText } from '../../components/EllipsisText'
import { LoadingPlaceholder } from '../../components/LoadingPlaceholder'
import { TABLE_SCROLL_X } from '../../components/tablePresets'
import { AlertStatusCard, LATEST_ALERT_LIMIT } from './AlertStatusCard'
import type { AlertCounts } from './AlertStatusCard'
import { QuickAccess } from './QuickAccess'
import { OnboardingSteps } from './OnboardingSteps'
import { SurfaceCard } from './SurfaceCard'

interface Status {
  version: string
  mode: string
}

/** 最新告警条数上限取自 AlertStatusCard.LATEST_ALERT_LIMIT（告警卡标题与本页截断共用一份） */

const STATUS_MOCK: Status = {
  version: 'dev-preview',
  mode: 'static-preview',
}

const DASHBOARD_MOCK: DashboardSummary = {
  resource_count: 0,
  monitored_count: 0,
  scrape_job_count: 0,
  scrape_job_enabled_count: 0,
  pending_draft_count: 0,
  recent_deployments: [],
  domain_count: 0,
}

const ALERT_MOCK: AlertCounts = {
  active: 2,
  silenced: 1,
  inhibited: 0,
  unprocessed: 0,
  firing: 3,
  pending: 1,
}

/** 静态预览用最新告警样例（无后端时保持告警卡形态完整，数量与卡内上限一致便于校验行高与表头对齐） */
const ALERT_MOCK_LATEST: AmAlertItem[] = [
  {
    labels: { alertname: '主机 CPU 使用率过高', severity: 'error' },
    annotations: {},
    starts_at: '2026-09-14T10:00:00Z',
    resource_name: 'web-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '数据库连接数接近上限', severity: 'warning' },
    annotations: {},
    starts_at: '2026-09-14T08:30:00Z',
    resource_name: 'db-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '磁盘使用率接近上限', severity: 'warning' },
    annotations: {},
    starts_at: '2026-09-14T07:10:00Z',
    resource_name: 'db-02',
    notify_status: 'silenced',
  },
  {
    labels: { alertname: '节点失联', severity: 'critical' },
    annotations: {},
    starts_at: '2026-09-14T05:45:00Z',
    resource_name: 'web-02',
    notify_status: 'active',
  },
  {
    labels: { alertname: '接口错误率升高', severity: 'error' },
    annotations: {},
    starts_at: '2026-09-14T04:20:00Z',
    resource_name: 'app-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '内存使用率偏高', severity: 'warning' },
    annotations: {},
    starts_at: '2026-09-14T03:05:00Z',
    resource_name: '',
    notify_status: 'inhibited',
  },
  {
    labels: { alertname: 'Kafka 消费延迟增长', severity: 'warning' },
    annotations: {},
    starts_at: '2026-09-14T01:40:00Z',
    resource_name: 'mw-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: 'Redis 主从同步中断', severity: 'critical' },
    annotations: {},
    starts_at: '2026-09-13T22:15:00Z',
    resource_name: 'redis-01',
    notify_status: 'silenced',
  },
  {
    labels: { alertname: 'Nginx 上游健康检查失败', severity: 'error' },
    annotations: {},
    starts_at: '2026-09-13T20:00:00Z',
    resource_name: 'nginx-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: 'MySQL 慢查询数突增', severity: 'info' },
    annotations: {},
    starts_at: '2026-09-13T18:30:00Z',
    resource_name: 'db-03',
    notify_status: 'active',
  },
]

const IS_STATIC_PREVIEW = import.meta.env.VITE_STATIC_PREVIEW === 'true'

/** 时间展示：ISO 转本地可读串（与 M08 告警页口径一致：本地时区、24 小时制） */
function formatTime(iso?: string): string {
  if (!iso) return '-'
  const d = dayjs(iso)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : '-'
}

/**
 * 告警排序用时间戳：缺失或非法 `starts_at` 计 0（排到末位），
 * 避免 `dayjs(undefined)` 视作「当前时间」而把无时间条目顶到最前、或 NaN 比较器导致顺序不定。
 */
function alertTime(iso?: string): number {
  if (!iso) return 0
  const d = dayjs(iso)
  return d.isValid() ? d.valueOf() : 0
}

/** 下发状态用户文案（复用 M09 枚举字典，禁止把 snake_case 枚举值当文案） */
function deploymentStatusText(status: string): string {
  return (deploymentStatusLabel as Record<string, string>)[status] ?? status
}

/** 下发状态色（复用 M09 枚举色，语义色点 + 文字，颜色不作为唯一语义） */
function deploymentStatusBadge(status: string): BadgeProps['status'] {
  return (deploymentStatusColor as Record<string, BadgeProps['status']>)[status] ?? 'default'
}

const DEPLOYMENT_COLUMNS: ColumnsType<RecentDeployment> = [
  {
    title: '变更单号',
    dataIndex: 'change_no',
    key: 'change_no',
    render: (value: string) => <EllipsisText>{value}</EllipsisText>,
  },
  {
    title: '网域',
    dataIndex: 'network_domain_name',
    key: 'network_domain_name',
    render: (value: string) => <EllipsisText>{value}</EllipsisText>,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    render: (value: string) => (
      <Badge status={deploymentStatusBadge(value)} text={deploymentStatusText(value)} />
    ),
  },
  {
    title: '下发时间',
    dataIndex: 'triggered_at',
    key: 'triggered_at',
    render: (value: string) => <Typography.Text>{formatTime(value)}</Typography.Text>,
  },
]

/**
 * 单数据源取数结果归一：网络异常与业务错误信封（status: 'error'）统一转 error，
 * 不静默吞 0（决策 68-2：AM 未挂载时数字恒为 0，必须与「请求失败」区分）。
 */
function toSourceState<T>(
  settled: PromiseSettledResult<ApiResponse<T>>,
): { res: ApiResponse<T> | null; error: string | null } {
  if (settled.status === 'rejected') {
    const reason: unknown = settled.reason
    return { res: null, error: reason instanceof Error ? reason.message : String(reason) }
  }
  if (settled.value.status === 'success') {
    return { res: settled.value, error: null }
  }
  return { res: null, error: settled.value.error || '请求失败' }
}

/** 告警计数：AM 通知四态（active / silenced / inhibited / unprocessed）+ Prom 触发态 */
function computeCounts(
  promRes: ApiResponse<PromAlertsData> | null,
  amRes: ApiResponse<AmAlertsData> | null,
): AlertCounts {
  // promRes / amRes 仅在信封 status === 'success' 时被写入（见 toSourceState），
  // 业务错误信封不会静默计 0，而是走 promError / amError 呈现。
  const promAlerts: PromAlertItem[] = promRes?.data?.alerts ?? []
  const amAlerts: AmAlertItem[] = amRes?.data?.items ?? []
  return {
    active: amAlerts.filter((i) => i.notify_status === 'active').length,
    silenced: amAlerts.filter((i) => i.notify_status === 'silenced').length,
    inhibited: amAlerts.filter((i) => i.notify_status === 'inhibited').length,
    unprocessed: amAlerts.filter((i) => i.notify_status === 'unprocessed').length,
    firing: promAlerts.filter((a) => a.state === 'firing').length,
    pending: promAlerts.filter((a) => a.state === 'pending').length,
  }
}

interface AlertGovernance {
  counts: AlertCounts
  /** 最新告警：AM 条目按 starts_at 倒序取前 5，剔除 unprocessed（治理闭环 MVP 未实现） */
  latestAlerts: AmAlertItem[]
  loading: boolean
  promError: string | null
  amError: string | null
  retry: () => void
}

/**
 * 首页告警治理态取数（单次请求持有）。
 * allSettled：单端点失败不丢弃另一端点已成功数据，失败源局部降级提示。
 */
function useAlertGovernance(
  isStaticPreview: boolean,
  mockCounts: AlertCounts,
  mockLatest: AmAlertItem[],
): AlertGovernance {
  const [promRes, setPromRes] = useState<ApiResponse<PromAlertsData> | null>(null)
  const [amRes, setAmRes] = useState<ApiResponse<AmAlertsData> | null>(null)
  const [promError, setPromError] = useState<string | null>(null)
  const [amError, setAmError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !isStaticPreview)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (isStaticPreview) {
      return
    }
    let cancelled = false
    Promise.allSettled([alertStatusApi.getPromAlerts(), alertStatusApi.getAlertmanagerAlerts()]).then(
      ([prom, am]) => {
        if (cancelled) return
        const p = toSourceState(prom)
        const a = toSourceState(am)
        setPromRes(p.res)
        setAmRes(a.res)
        setPromError(p.error)
        setAmError(a.error)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
  }, [isStaticPreview, retryKey])

  const counts = useMemo(
    () => (isStaticPreview ? mockCounts : computeCounts(promRes, amRes)),
    [isStaticPreview, mockCounts, promRes, amRes],
  )

  const latestAlerts = useMemo(() => {
    if (isStaticPreview) {
      return mockLatest
    }
    const items = amRes?.data?.items ?? []
    return items
      .filter((i) => i.notify_status !== 'unprocessed')
      .sort((a, b) => alertTime(b.starts_at) - alertTime(a.starts_at))
      .slice(0, LATEST_ALERT_LIMIT)
  }, [isStaticPreview, mockLatest, amRes])

  const retry = () => {
    // 静态预览无后端：effect 提前 return，置 loading 会永久停在加载态，直接短路
    if (isStaticPreview) return
    setLoading(true)
    setPromError(null)
    setAmError(null)
    setRetryKey((k) => k + 1)
  }

  return { counts, latestAlerts, loading, promError, amError, retry }
}

interface MetricItem {
  key: string
  label: string
  value: ReactNode
  icon: ReactNode
  /** 口径注释（卡片右上角 ⓘ Tooltip 文案，决策 72-3 §3.2） */
  tip?: string
  /** 副行说明（如采集 Job 的「启用 N」） */
  hint?: string
}

/**
 * 关键指标卡：图标 32px + 数字 24px/700 + 标签 13px colorTextSecondary（决策 72-2 视觉规格）。
 *
 * 采用「图标在左、数字与标签在右」的横向排版：6 列网格下单卡内容区仅约 130px，
 * 竖排堆叠时图标与数字间距、数字与标签间距相同（都是 8px），三者平权且卡内上下
 * 留白过大（旧实现 `minHeight: 108` 使卡高 148px、内容仅占 70px）；横向排版在同样
 * 宽度内更饱满，数字作为视觉主体更突出。
 */
function MetricCard({ item }: { item: MetricItem }) {
  const { token } = theme.useToken()

  return (
    <SurfaceCard
      hoverShadow
      data-testid={`metric-${item.key}`}
      style={{ height: '100%' }}
      styles={{ body: { padding: '16px 18px' } }}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* 口径注释：仅 tip 非空时渲染（ⓘ 不参与视觉主体，用 tertiary 文字色）；
            可聚焦 + aria-label，保证键盘用户也能读到口径说明 */}
        {item.tip && (
          <Tooltip title={item.tip}>
            <InfoCircleOutlined
              data-testid={`metric-tip-${item.key}`}
              tabIndex={0}
              aria-label={item.tip}
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                fontSize: 14,
                color: token.colorTextTertiary,
                cursor: 'help',
              }}
            />
          </Tooltip>
        )}
        <span style={{ flex: 'none', fontSize: 32, lineHeight: 1, color: token.colorPrimary }}>
          {item.icon}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}>{item.value}</div>
          <Typography.Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
            {item.label}
          </Typography.Text>
          {item.hint && (
            <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
              {item.hint}
            </Typography.Text>
          )}
        </div>
      </div>
    </SurfaceCard>
  )
}

export function HomePage() {
  const [status, setStatus] = useState<Status | null>(() => (IS_STATIC_PREVIEW ? STATUS_MOCK : null))
  const [error, setError] = useState<string | null>(null)

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(() =>
    IS_STATIC_PREVIEW ? DASHBOARD_MOCK : null,
  )
  const [dashboardLoading, setDashboardLoading] = useState(() => !IS_STATIC_PREVIEW)
  const [dashboardError, setDashboardError] = useState<string | null>(null)

  const {
    counts,
    latestAlerts,
    loading: alertLoading,
    promError,
    amError,
    retry,
  } = useAlertGovernance(IS_STATIC_PREVIEW, ALERT_MOCK, ALERT_MOCK_LATEST)

  useEffect(() => {
    // Vercel 静态预览环境没有后端，不发起请求
    if (IS_STATIC_PREVIEW) {
      return
    }

    apiClient
      .get<Status>('/api/v1/status')
      .then((res) => {
        if (res.status === 'success') {
          setStatus(res.data)
        } else {
          setError(res.error || '请求失败')
        }
      })
      .catch((err: Error) => {
        setError(err.message)
      })
  }, [])

  useEffect(() => {
    if (IS_STATIC_PREVIEW) {
      return
    }

    dashboardApi
      .getSummary()
      .then((res) => {
        if (res.status === 'success') {
          setDashboard(res.data)
        } else {
          setDashboardError(res.error || '请求失败')
        }
        setDashboardLoading(false)
      })
      .catch((err: Error) => {
        setDashboardError(err.message)
        setDashboardLoading(false)
      })
  }, [])

  const recentDeployments = dashboard?.recent_deployments?.slice(0, 5) ?? []

  // 取数失败（含字段缺失）统一显示 '-'，不把失败静默成 0、也不渲染 NaN%（决策 72-3 §3.2 失败态）
  const metricNumber = (value?: number): number | undefined =>
    typeof value === 'number' && !Number.isNaN(value) ? value : undefined
  const metricValue = (value?: number): ReactNode => metricNumber(value) ?? '-'

  // 采集覆盖率：已监控 ÷ 资源总数，取整百分数；任一字段缺失或资源数为 0 时显示 '-'
  // （不渲染 0% / NaN%），前端派生无需新字段
  const resourceTotal = metricNumber(dashboard?.resource_count)
  const monitoredTotal = metricNumber(dashboard?.monitored_count)
  const coverage =
    resourceTotal !== undefined && resourceTotal > 0 && monitoredTotal !== undefined
      ? `${Math.round((monitoredTotal / resourceTotal) * 100)}%`
      : '-'

  const enabledJobCount = metricNumber(dashboard?.scrape_job_enabled_count)

  const metrics: MetricItem[] = [
    {
      key: 'resource_count',
      label: '资源总数',
      value: metricValue(dashboard?.resource_count),
      icon: <DatabaseOutlined />,
      tip: '已导入平台的监控资源总数，按主机、数据库、中间件、应用、拨测目标五类合计。',
    },
    {
      key: 'monitored_count',
      label: '已监控',
      value: metricValue(dashboard?.monitored_count),
      icon: <MonitorOutlined />,
      tip: '至少被一个已启用的采集任务覆盖到的资源数。',
    },
    {
      key: 'scrape_job_count',
      label: '采集 Job',
      value: metricValue(dashboard?.scrape_job_count),
      icon: <ClusterOutlined />,
      tip: '采集任务总数；「启用」为当前正在生效的任务数。',
      hint: enabledJobCount !== undefined ? `启用 ${enabledJobCount}` : undefined,
    },
    {
      key: 'domain_count',
      label: '已纳管网域',
      value: metricValue(dashboard?.domain_count),
      icon: <GlobalOutlined />,
      tip: '已纳入平台监控的网域数量。',
    },
    {
      key: 'pending_draft_count',
      label: '待确认草稿',
      value: metricValue(dashboard?.pending_draft_count),
      icon: <FileTextOutlined />,
      tip: '已生成配置草稿、但还没人工确认下发的变更数量。',
    },
    {
      key: 'coverage',
      label: '采集覆盖率',
      value: coverage,
      icon: <PieChartOutlined />,
      tip: '已监控资源数 ÷ 资源总数，反映当前纳管进度。',
    },
  ]

  return (
    <MainLayout>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* 页面引导语：页面归属已由左侧导航与面包屑表达，不再重复「MetricCenter 概览」大标题（用户反馈 2026-09-14）。
            引导语描述「本页有什么」，不指代下方区域：紧随其后的是指标卡，六步指引在页尾。 */}
        <Typography.Text type="secondary" style={{ fontSize: 14 }}>
          欢迎回到 MetricCenter，这里汇总监控资源、采集任务与告警的整体运行情况
        </Typography.Text>

        {/* 关键指标卡网格（纯资产与治理进度，不含告警数字；告警表达全部收敛到告警状态卡） */}
        <div data-testid="dashboard-card">
          {dashboardLoading && <LoadingPlaceholder />}
          {dashboardError && (
            <Alert message="请求失败" description={dashboardError} type="error" showIcon />
          )}
          <Row gutter={[16, 16]}>
            {metrics.map((item) => (
              <Col key={item.key} xs={24} sm={12} lg={8} xl={4}>
                <MetricCard item={item} />
              </Col>
            ))}
          </Row>
        </div>

        {/* 告警治理态大卡片（左，首页唯一告警入口）+ 快捷入口 / 最近下发（右）。
            align="stretch"：两列等高，告警条数少时左卡跟随右列高度撑满，
            由卡内 marginTop:auto 把参考行贴底，避免卡下方留白（用户反馈 2026-09-14）。 */}
        <Row gutter={[16, 16]} align="stretch">
          <Col xs={24} lg={10}>
            <AlertStatusCard
              counts={counts}
              latestAlerts={latestAlerts}
              loading={alertLoading}
              promError={promError}
              amError={amError}
              onRetry={retry}
              isStaticPreview={IS_STATIC_PREVIEW}
            />
          </Col>
          <Col xs={24} lg={14}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <QuickAccess />
              {/* 卡内只展示最近 5 条，完整记录在 /deployments（决策 72-3 §3.1「右侧可放查看更多链接」） */}
              <SurfaceCard
                title="最近下发记录"
                extra={
                  <Link to="/deployments" style={{ fontSize: 13 }}>
                    查看全部 →
                  </Link>
                }
              >
                {recentDeployments.length === 0 ? (
                  <Typography.Text type="secondary">暂无下发记录</Typography.Text>
                ) : (
                  <Table
                    rowKey="id"
                    size="small"
                    columns={DEPLOYMENT_COLUMNS}
                    dataSource={recentDeployments}
                    pagination={false}
                    scroll={TABLE_SCROLL_X}
                  />
                )}
              </SurfaceCard>
            </Space>
          </Col>
        </Row>

        {/* 使用指引（六步闭环） */}
        <OnboardingSteps />

        {/* 系统状态标注：版本 / 模式放在页面角落，不占据首屏中央 */}
        {(status || error) && (
          <div style={{ textAlign: 'right' }}>
            <Typography.Text type={error ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
              <Space size={16}>
                {status && <span>版本 {status.version}</span>}
                {status && <span>模式 {status.mode}</span>}
                {error && <span>状态加载失败：{error}</span>}
              </Space>
            </Typography.Text>
          </div>
        )}
      </Space>
    </MainLayout>
  )
}

export default HomePage