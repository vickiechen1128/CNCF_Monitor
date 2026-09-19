/**
 * 首页概览（Module_05 §3.1「首页（MVP 子集）交互契约」决策 72 / 72-1 / 72-2 / 72-3 / 73）。
 *
 * 页面结构（自上而下，决策 72-2 / 72-3 / 73）：
 * 页头行（引导语 + 系统状态）→ 关键指标卡网格（6 张资产与治理进度卡，纵向排版 + 口径注释）→
 * 双列区：左列告警状态卡（首页唯一告警入口，卡内自适应分页）/ 右列（系统快速入口 → 最近下发记录 → 使用指引）。
 *
 * 版式约束（用户 2026-09-18 反馈，已两轮修正）：
 * - 页面按内容自然排布，**不锁定视口**：不同电脑尺寸/分辨率下版式一致，内容超出即滚动
 *   （首版曾用 MainLayout fitViewport 单屏铺满，因把「内容量」与「视口高度」强绑定而移除）；
 * - 双列区两列**等高**（CSS Grid align-items: stretch + 右列纵向 flex 兜底），
 *   使「使用指引」能整体移到双列下方而不被两列高度差顶出空白；
 * - 告警卡与「最近下发记录」按行数对齐（方案乙：告警 5 行 ↔ 下发 6 行），
 *   少告警时由双列区 min-height 兜底，差额落在告警卡的白底上（见 homeLayout.ts）。
 *
 * 数据源（决策 72-3 放宽「零后端改动」，见
 * docs/05-execution-records/module-05/design-proposals/homepage-mvp-content-restructure.md）：
 * - dashboardApi.getSummary()：资源总数 / 已监控 / 采集 Job / 已纳管网域 / 待确认草稿 / 最近下发；
 *   「采集覆盖率」由 已监控 ÷ 资源总数 前端派生；
 * - alertStatusApi 三条只读链路**单次请求**由 useAlertGovernance 持有：
 *   Prom 触发告警 + AM 通知状态（数字与最新告警同源，不重复取数）+
 *   M02 历史告警（决策 73：当日 / 近 7 天告警前端计数 + 行 2 告警具体内容回查）；
 *   指标卡**不出现任何告警数字**。
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
import { useProductName } from '../../skinContext'
import type { DashboardSummary, RecentDeployment } from '../../api/dashboard'
import { alertStatusApi, ALERT_HISTORY_STEP_SECONDS } from '../../api/alertmanager'
import type {
  AlertHistoryData,
  AmAlertItem,
  AmAlertsData,
  PromAlertItem,
  PromAlertsData,
} from '../../types/alertmanager'
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
import { alertMatchKey } from '../alerts/alertmanagerConstants'
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
  today: 12,
  week: 38,
  active: 2,
  silenced: 1,
  inhibited: 0,
  unprocessed: 0,
  firing: 3,
  pending: 1,
}

/**
 * 静态预览用最新告警样例（无后端时保持告警卡形态完整，数量与卡内上限一致便于校验行高与「查看全部」语义）。
 * 每条携带 annotations.summary（行 2 告警具体内容）与 labels.instance（history 回查键的一半）。
 */
const ALERT_MOCK_LATEST: AmAlertItem[] = [
  {
    labels: { alertname: '主机 CPU 使用率过高', severity: 'critical', instance: '10.0.0.11:9100' },
    annotations: { summary: 'CPU 使用率 92%，超过阈值 85% 已持续 5 分钟' },
    starts_at: '2026-09-18T09:32:00Z',
    resource_name: 'prod-web-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '节点离线', severity: 'critical', instance: '10.0.2.7:9100' },
    annotations: { summary: '节点已 60 秒无响应，疑似断网或采集进程异常' },
    starts_at: '2026-09-18T09:28:00Z',
    resource_name: 'edge-node-03',
    notify_status: 'active',
  },
  {
    labels: { alertname: '磁盘空间不足', severity: 'warning', instance: '10.0.1.5:9100' },
    annotations: { summary: '数据盘使用率 91%，预计 6 小时后写满' },
    starts_at: '2026-09-18T09:15:00Z',
    resource_name: 'prod-db-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: '服务拨测失败', severity: 'critical', instance: 'http://order-svc:8080/health' },
    annotations: { summary: 'HTTP 探针连续 3 次超时（>3s）' },
    starts_at: '2026-09-18T08:58:00Z',
    resource_name: 'order-service-v2',
    notify_status: 'silenced',
  },
  {
    labels: { alertname: '内存使用率偏高', severity: 'warning', instance: '10.0.3.9:9100' },
    annotations: { summary: '内存使用率 88%，接近告警阈值 90%' },
    starts_at: '2026-09-18T08:40:00Z',
    resource_name: 'redis-cache-01',
    notify_status: 'inhibited',
  },
  {
    labels: { alertname: '数据库连接数接近上限', severity: 'warning', instance: '10.0.1.6:3306' },
    annotations: { summary: '当前连接数 480 / 上限 500，新增连接将被拒绝' },
    starts_at: '2026-09-18T08:20:00Z',
    resource_name: 'prod-mysql-01',
    notify_status: 'active',
  },
  {
    labels: { alertname: 'Kafka 消费延迟增长', severity: 'warning', instance: '10.0.4.2:9092' },
    annotations: { summary: '消费组 order-group 积压 12 万条，延迟 8 分钟' },
    starts_at: '2026-09-18T07:40:00Z',
    resource_name: 'kafka-broker-02',
    notify_status: 'active',
  },
  {
    labels: { alertname: 'Nginx 上游健康检查失败', severity: 'info', instance: 'http://nginx-01/status' },
    annotations: { summary: '上游 app-03 连续 5 次健康检查失败' },
    starts_at: '2026-09-18T07:00:00Z',
    resource_name: 'nginx-01',
    notify_status: 'silenced',
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

/**
 * 「最近下发记录」卡内固定条数（用户 2026-09-18 决策「方案乙」）。
 * 与告警卡的 `homeLayout.ALERT_PAGE_SIZE`（5 行/页）配套，使左右两列在满数据时近似等高；
 * 两者同为版式常量，**改一处需同改另一处**。
 */
const DEPLOYMENT_ROW_LIMIT = 6

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

/** 近 7 天告警窗口（决策 73：与 M02 history 服务端最大时间窗一致） */
const HISTORY_WINDOW_DAYS = 7

/** history 单页取数上限（服务端 maxHistoryPageSize = 200，一次拉满减少分页往返） */
const HISTORY_PAGE_SIZE = 200

/**
 * 历史告警取数参数：窗口按服务端上限 7d（决策 73 只关心当日 / 近 7 天）。
 *
 * - **必须显式传 `step`（决策 90）**：取 `ALERT_HISTORY_STEP_SECONDS`（30s，PRD 默认细粒度）。
 *   本卡窗口恒为 7d，7d ÷ 30s = 20160 点超过 Prometheus 单序列 11000 点上限 → 上游 400 →
 *   本卡「当日 / 近 7 天告警」两格恒为 0（2026-09-18 实测缺陷）；服务端会按窗口把 30s 抬高到
 *   55s 兜底，但调用侧仍显式传值，避免行为依赖服务端默认；
 * - 窗口直接取整 7d：服务端会把 > 7d 的窗口压缩为 `[end-7d, end]`，故多加容差无实际效果，
 *   反而是让 `total` 与「近 7 天」口径严格一致的前提（见 computeHistoryCounts）。
 */
function historyQuery(): { start: string; end: string; step: number; page: number; page_size: number } {
  const now = dayjs()
  return {
    start: now.subtract(HISTORY_WINDOW_DAYS, 'day').toISOString(),
    end: now.toISOString(),
    step: ALERT_HISTORY_STEP_SECONDS,
    page: 1,
    page_size: HISTORY_PAGE_SIZE,
  }
}

/** fired_at 时间戳：缺失 / 非法计 0（不落入「今日」或「近 7 天」计数，也不抛错） */
function firedAt(value?: string): number {
  if (!value) return 0
  const d = dayjs(value)
  return d.isValid() ? d.valueOf() : 0
}

/**
 * 历史告警计数（决策 73 §1，决策 90 修订）：当日 = fired_at ≥ 今日 0 点；近 7 天 = 服务端窗口总量。
 *
 * **「近 7 天」直接取服务端 `total`**：请求窗口与「近 7 天」口径严格一致（7d，服务端裁剪后
 * 亦为 `[end-7d, end]`），`total` 即该窗口内的触发区间总数。原实现把 `total` 与前端**按渲染
 * 时刻**重算边界的 `inWindow` 做大小比较，两个边界不同源（渲染时刻晚于请求时刻），导致 7d
 * 边界外刚过期的记录被计入，与卡片文案「近 7 天」不符 —— 取消该混用。
 * 单页上限（200）截断的只是**列表**且按触发时间倒序（丢的是最旧记录），故 `today` 仍由当前页
 * 统计；`total` 缺失（契约异常）时回落为页内条目数。
 *
 * 字段缺失（无 list）返回 null，由调用方把两格降级为 '-'（不显示 0）。
 */
function computeHistoryCounts(
  res: ApiResponse<AlertHistoryData> | null,
): { today: number; week: number } | null {
  const items = res?.data?.list
  if (!Array.isArray(items)) return null

  const dayStart = dayjs().startOf('day').valueOf()
  const today = items.filter((item) => firedAt(item.fired_at) >= dayStart).length
  const total = res?.data?.total
  const week = typeof total === 'number' ? total : items.length
  return { today, week }
}

/**
 * 行 2 告警具体内容回查表（决策 73 §3）：M02 history 的 summary 优先，AM annotations.summary 兜底。
 * 键由 alertMatchKey（告警名 + 采集地址）生成，与告警卡取值端共用一份逻辑。
 */
function buildSummaryMap(res: ApiResponse<AlertHistoryData> | null): Record<string, string> {
  const items = res?.data?.list
  if (!Array.isArray(items)) return {}
  const map: Record<string, string> = {}
  for (const item of items) {
    const summary = item.summary?.trim()
    if (!summary) continue
    const key = alertMatchKey(item.alertname, item.instance)
    // 同一告警名 + 实例可能有多段触发区间：保留最近一段（history 按时间倒序返回时首条即最新）
    if (!(key in map)) map[key] = summary
  }
  return map
}

/** 告警计数：AM 通知四态（active / silenced / inhibited / unprocessed）+ Prom 触发态 */
function computeCounts(
  promRes: ApiResponse<PromAlertsData> | null,
  amRes: ApiResponse<AmAlertsData> | null,
): Omit<AlertCounts, 'today' | 'week'> {
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
  /** 最新告警：AM 条目按 starts_at 倒序取前 LATEST_ALERT_LIMIT 条，剔除 unprocessed（治理闭环 MVP 未实现） */
  latestAlerts: AmAlertItem[]
  /** 行 2 告警具体内容回查表（history summary 优先，AM annotations.summary 兜底） */
  summaryByAlert: Record<string, string>
  loading: boolean
  promError: string | null
  amError: string | null
  /** history 链路错误：当日 / 近 7 天两格降级为 '-'，不影响 AM / Prom 展示 */
  historyError: string | null
  retry: () => void
}

/**
 * 首页告警治理态取数（三条只读链路各单次请求持有）。
 * allSettled：任一端点失败不丢弃其他端点已成功数据，失败源局部降级提示。
 */
function useAlertGovernance(
  isStaticPreview: boolean,
  mockCounts: AlertCounts,
  mockLatest: AmAlertItem[],
): AlertGovernance {
  const [promRes, setPromRes] = useState<ApiResponse<PromAlertsData> | null>(null)
  const [amRes, setAmRes] = useState<ApiResponse<AmAlertsData> | null>(null)
  const [historyRes, setHistoryRes] = useState<ApiResponse<AlertHistoryData> | null>(null)
  const [promError, setPromError] = useState<string | null>(null)
  const [amError, setAmError] = useState<string | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => !isStaticPreview)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    if (isStaticPreview) {
      return
    }
    let cancelled = false
    Promise.allSettled([
      alertStatusApi.getPromAlerts(),
      alertStatusApi.getAlertmanagerAlerts(),
      alertStatusApi.getAlertHistory(historyQuery()),
    ]).then(([prom, am, history]) => {
      if (cancelled) return
      const p = toSourceState(prom)
      const a = toSourceState(am)
      const h = toSourceState(history)
      setPromRes(p.res)
      setAmRes(a.res)
      setHistoryRes(h.res)
      setPromError(p.error)
      setAmError(a.error)
      // 字段缺失（信封成功但无 list）同样视为不可用：两格显示 '-' 而非 0
      setHistoryError(
        h.error ?? (Array.isArray(h.res?.data?.list) ? null : '历史告警响应缺少列表字段'),
      )
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [isStaticPreview, retryKey])

  const counts = useMemo(() => {
    if (isStaticPreview) {
      return mockCounts
    }
    const history = computeHistoryCounts(historyRes)
    return {
      ...computeCounts(promRes, amRes),
      // history 不可用时由 AlertStatusCard 按 historyError 渲染 '-'，此处仅提供占位数值
      today: history?.today ?? 0,
      week: history?.week ?? 0,
    }
  }, [isStaticPreview, mockCounts, promRes, amRes, historyRes])

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

  const summaryByAlert = useMemo(
    () => (isStaticPreview ? {} : buildSummaryMap(historyRes)),
    [isStaticPreview, historyRes],
  )

  const retry = () => {
    // 静态预览无后端：effect 提前 return，置 loading 会永久停在加载态，直接短路
    if (isStaticPreview) return
    setLoading(true)
    setPromError(null)
    setAmError(null)
    setHistoryError(null)
    setRetryKey((k) => k + 1)
  }

  return { counts, latestAlerts, summaryByAlert, loading, promError, amError, historyError, retry }
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
 * 关键指标卡：纵向排版（决策 73 §4 视觉规格，自 v1.5 横向排版修订）——
 * 标签 12px 在上、数字 30px/800（等宽数字）在下、44px 圆角图标容器右下（内 22px 图标、品牌青 10% 浅底）。
 * 数字提到 30px/800 后成为卡内唯一视觉主体，卡高由内容决定（删除旧 `minHeight` 兜底）。
 */
function MetricCard({ item }: { item: MetricItem }) {
  const { token } = theme.useToken()

  return (
    <SurfaceCard
      hoverShadow
      data-testid={`metric-${item.key}`}
      style={{ position: 'relative', height: '100%' }}
      styles={{ body: { padding: '14px 16px' } }}
    >
      {/* 标签行：标签 12px；副行说明（如采集 Job 的「启用 N」）紧随其后同排，不另起一行 */}
      <div style={{ fontSize: 12, color: token.colorTextSecondary, whiteSpace: 'nowrap' }}>
        {item.label}
        {item.hint && <span style={{ marginLeft: 6, color: token.colorTextTertiary }}>{item.hint}</span>}
      </div>

      {/* 数字与图标容器同排：数字在左（30px/800），图标容器右下贴边（44px 圆角 + 品牌青 10% 浅底） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 8,
        }}
      >
        <span
          style={{
            fontSize: 30,
            fontWeight: 800,
            lineHeight: 1.1,
            color: token.colorText,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {item.value}
        </span>
        <span
          data-testid={`metric-icon-${item.key}`}
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            background: token.colorPrimaryBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1, color: token.colorPrimary }}>{item.icon}</span>
        </span>
      </div>

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
              top: 12,
              right: 12,
              fontSize: 13,
              color: token.colorTextTertiary,
              cursor: 'help',
            }}
          />
        </Tooltip>
      )}
    </SurfaceCard>
  )
}

export function HomePage() {
  // 引导语中的产品名随「外观设置」变化（用户 2026-09-18 补充）
  const { productName } = useProductName()
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
    summaryByAlert,
    loading: alertLoading,
    promError,
    amError,
    historyError,
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

  /**
   * 最近下发记录：卡内固定展示 DEPLOYMENT_ROW_LIMIT 条，完整记录在 /deployments
   * （决策 72-3 §3.1「右侧可放查看更多链接」）。
   */
  const recentDeployments = dashboard?.recent_deployments?.slice(0, DEPLOYMENT_ROW_LIMIT) ?? []

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
      {/* 内容自然高度（用户 2026-09-18 二次反馈「不同电脑尺寸不一样，直接铺满不满足各类场景」）：
          根容器纵向 flex 排布页头行 / 指标卡 / 双列区，但**不锁定视口高度**——
          视口够高时视觉上仍接近一屏，视口矮或内容多时正常滚动，不做裁切、不拉伸卡片。
          gap 用 16，与卡片 gutter 一致（首版为挤出「一屏」曾收到 12，现无此必要）。 */}
      <div
        data-testid="home-page"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* 页头行：左引导语 + 右系统状态（版本 / 模式）。原先版本行独占页尾一行，
            上移后省一行高度，与「整页不出现下拉进度条」的目标一致。 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          {/* 页面引导语：页面归属已由左侧导航与面包屑表达，不再重复「MetricCenter 概览」大标题（用户反馈 2026-09-14）。
              引导语描述「本页有什么」，不指代下方区域：紧随其后的是指标卡，六步指引在双列区下方。 */}
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            欢迎回到 {productName}，这里汇总监控资源、采集任务与告警的整体运行情况
          </Typography.Text>
          {/* 系统状态标注：版本 / 模式，右对齐在页头行（不再占据页尾） */}
          {(status || error) && (
            <Typography.Text
              type={error ? 'danger' : 'secondary'}
              style={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              <Space size={16}>
                {status && <span>版本 {status.version}</span>}
                {status && <span>模式 {status.mode}</span>}
                {error && <span>状态加载失败：{error}</span>}
              </Space>
            </Typography.Text>
          )}
        </div>

        {/* 关键指标卡网格（纯资产与治理进度，不含告警数字；告警表达全部收敛到告警状态卡） */}
        <div data-testid="dashboard-card" style={{ flex: 'none' }}>
          {dashboardLoading && <LoadingPlaceholder />}
          {dashboardError && (
            <Alert message="请求失败" description={dashboardError} type="error" showIcon />
          )}
          <Row gutter={[16, 16]}>
            {metrics.map((item) => (
              <Col key={item.key} xs={24} sm={12} md={8} xl={4}>
                <MetricCard item={item} />
              </Col>
            ))}
          </Row>
        </div>

        {/* 双列区（决策 73 §6，版式经 2026-09-18 三轮修订）：
            左列告警状态卡（首页唯一告警入口），右列 系统快速入口 → 最近下发记录。
            等高手段（用户拍板「①内容对齐为主 + ②flex 兜底」）：
            ① 两列按行数对齐——告警 5 行/页（homeLayout.ALERT_PAGE_SIZE）↔ 最近下发 6 条
               （DEPLOYMENT_ROW_LIMIT），满数据时两列高度自然接近；
            ② flex 兜底——两列 align-items: stretch 等高，残余落差吸收到告警卡的白底上
               （告警卡页脚用 margin-top:auto 贴底，落差落在列表下方而非卡片下方）。
               ⚠️ 此处**显式写 alignItems** 而非用 antd 的 align 属性：Row 的 align 只支持
               top / middle / bottom（会覆盖 flex 默认的 stretch），传 'stretch' 会生成一个
               无对应样式的 class，看似设置实则无效。显式内联也防止将来有人加 align 属性破坏等高。
            双列区整体 min-height 420px：告警极少（如 2 条）时两列仍有基本体量，不会缩成窄卡。
            使用指引已移出右列、改为双列**下方**的整宽一行（用户 2026-09-18 决策）：
            两列等高后下方才留得出干净的整宽位置，六步闭环横向铺开也比挤在 14/24 列里易读。 */}
        <Row gutter={[16, 16]} style={{ alignItems: 'stretch', minHeight: 420 }}>
          <Col xs={24} lg={10}>
            <AlertStatusCard
              counts={counts}
              latestAlerts={latestAlerts}
              summaryByAlert={summaryByAlert}
              loading={alertLoading}
              promError={promError}
              amError={amError}
              historyError={historyError}
              onRetry={retry}
              isStaticPreview={IS_STATIC_PREVIEW}
            />
          </Col>
          <Col xs={24} lg={14}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                height: '100%',
              }}
            >
              <QuickAccess />
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
            </div>
          </Col>
        </Row>

        {/* 使用指引（六步闭环）：双列区下方整宽卡片（用户 2026-09-18 决策，原为右列第三张卡） */}
        <OnboardingSteps />
      </div>
    </MainLayout>
  )
}

export default HomePage