import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import dayjs from 'dayjs'
import { HomePage } from './HomePage'
import { ALERT_HISTORY_STEP_SECONDS } from '../../api/alertmanager'
import { severityBg } from '../alerts/alertmanagerConstants'
import { LATEST_ALERT_LIMIT } from './AlertStatusCard'
import { ALERT_PAGE_SIZE } from './homeLayout'
import { DEFAULT_SKIN, skinTokens } from '../../skins'
import { DEFAULT_PRODUCT_NAME } from '../../productNamePreference'
import { setupAntdTest } from '../../test/antdTestUtils'

const mockGet = vi.fn()

vi.mock('../../api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}))

vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div data-testid="main-layout">{children}</div>,
}))

// 首页子组件（QuickAccess / OnboardingSteps / AlertStatusCard 空态引导）使用 react-router Link
const renderPage = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )

const STATUS_PATH = '/api/v1/status'
const DASHBOARD_PATH = '/api/v2/platform/dashboard/summary'
const PROM_ALERTS_PATH = '/api/v1/alerts'
const AM_ALERTS_PATH = '/api/v2/platform/alertmanager/alerts'
/** M02 历史告警（决策 73：当日 / 近 7 天计数 + 列表行 2 告警具体内容） */
const HISTORY_PATH = '/api/v1/alerts/history'

/** 六张关键指标卡的 key（决策 72-3：纯资产与治理进度口径，不含告警数字） */
const METRIC_KEYS = [
  'resource_count',
  'monitored_count',
  'scrape_job_count',
  'domain_count',
  'pending_draft_count',
  'coverage',
]

/** 页面引导语：页内首行文案（决策 72-2；页面归属由导航表达，不重复「MetricCenter 概览」大标题）。
 *  产品名取自当前外观设置，测试中用默认名常量拼装，改名后不必逐处搜索字面量。 */
const PAGE_INTRO = `欢迎回到 ${DEFAULT_PRODUCT_NAME}，这里汇总监控资源、采集任务与告警的整体运行情况`

/** hex → jsdom 归一化后的 rgb() 串（内联 hex 背景在 jsdom 中被转成 rgb() 形式） */
const toRgbString = (hex: string): string => {
  const value = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  return `rgb(${r}, ${g}, ${b})`
}

/** 相对当前时间构造 ISO 串，避免断言「N 分钟前」时依赖固定时间 */
const isoAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

/**
 * 今日 0 点后 30 分钟（恒 ≥ 今日 0 点，且必然在过去）：
 * 用于「当日告警」计数断言，避免测试恰好在凌晨运行时 isoAgo 落到昨天导致 flaky。
 */
const isoToday = () => dayjs().startOf('day').add(30, 'minute').toISOString()

function setupMock(byPath: Record<string, unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path in byPath) {
      return Promise.resolve(byPath[path])
    }
    return Promise.reject(new Error(`unmocked path: ${path}`))
  })
}

function setupHomeMock(overrides: Record<string, unknown> = {}) {
  setupMock({
    [STATUS_PATH]: STATUS_OK,
    [DASHBOARD_PATH]: DASHBOARD_OK,
    [PROM_ALERTS_PATH]: PROM_ALERTS_EMPTY,
    [AM_ALERTS_PATH]: AM_ALERTS_EMPTY,
    [HISTORY_PATH]: HISTORY_EMPTY,
    ...overrides,
  })
}

const STATUS_OK = {
  status: 'success',
  data: { version: 'v0.1.0', mode: 'standalone' },
}

const DASHBOARD_OK = {
  status: 'success',
  data: {
    resource_count: 10,
    monitored_count: 4,
    scrape_job_count: 3,
    scrape_job_enabled_count: 2,
    pending_draft_count: 3,
    domain_count: 2,
    recent_deployments: [
      {
        id: 'd1',
        change_no: 'CHG-001',
        network_domain_name: '政务网A区',
        status: 'success',
        triggered_at: '2026-08-24T10:00:00Z',
      },
    ],
  },
}

const DASHBOARD_EMPTY = {
  status: 'success',
  data: {
    resource_count: 0,
    monitored_count: 0,
    scrape_job_count: 0,
    scrape_job_enabled_count: 0,
    pending_draft_count: 0,
    domain_count: 0,
    recent_deployments: [],
  },
}

const PROM_ALERTS_OK = {
  status: 'success',
  data: {
    alerts: [
      { state: 'firing', labels: {}, annotations: {}, activeAt: '2026-09-14T00:00:00Z' },
      { state: 'firing', labels: {}, annotations: {}, activeAt: '2026-09-14T00:00:00Z' },
      { state: 'pending', labels: {}, annotations: {}, activeAt: '2026-09-14T00:00:00Z' },
    ],
  },
}

const PROM_ALERTS_EMPTY = {
  status: 'success',
  data: { alerts: [] },
}

/**
 * AM 通知状态样例：active 3 / silenced 1 / inhibited 1 / unprocessed 1。
 * starts_at 依次为 5 分钟 / 30 分钟 / 2 小时 / 3 小时 / 1 天前 → 列表（剔除 unprocessed 后）
 * 恰为 5 条且顺序确定；第 4 条 resource_name 为空，用于校验不回落成采集地址。
 * labels.instance 与 annotations.summary 供行 2（实例名 · 告警具体内容）断言。
 */
const AM_ALERTS_OK = {
  status: 'success',
  data: {
    items: [
      {
        notify_status: 'active',
        labels: { alertname: '主机 CPU 使用率过高', severity: 'error', instance: '10.0.0.11:9100' },
        annotations: { summary: 'AM 兜底内容（应被 history summary 覆盖）' },
        starts_at: isoAgo(5),
        resource_name: 'web-01',
      },
      {
        notify_status: 'active',
        labels: { alertname: '磁盘使用率接近上限', severity: 'warning', instance: '10.0.0.12:9100' },
        annotations: { summary: '磁盘使用率 91%，预计 6 小时后写满' },
        starts_at: isoAgo(30),
        resource_name: 'db-01',
      },
      {
        notify_status: 'active',
        labels: { alertname: '接口错误率升高', severity: 'info', instance: '10.0.0.13:9100' },
        annotations: {},
        starts_at: isoAgo(120),
        resource_name: 'app-01',
      },
      {
        notify_status: 'silenced',
        labels: { alertname: '内存使用率偏高', severity: 'warning', instance: '10.0.0.14:9100' },
        annotations: {},
        starts_at: isoAgo(180),
        resource_name: '',
      },
      {
        notify_status: 'inhibited',
        labels: { alertname: '节点失联', severity: 'critical', instance: '10.0.0.15:9100' },
        annotations: {},
        starts_at: isoAgo(1440),
        resource_name: 'web-02',
      },
      {
        notify_status: 'unprocessed',
        labels: { alertname: '队列积压', severity: 'warning', instance: '10.0.0.16:9100' },
        annotations: {},
        starts_at: isoAgo(1),
        resource_name: 'mw-01',
      },
    ],
  },
}

const AM_ALERTS_EMPTY = {
  status: 'success',
  data: { items: [] },
}

/**
 * M02 历史告警样例（决策 73）：当日 2 条（含 1 条与 AM 首条同键，用于校验 history summary 优先）、
 * 3 天前 1 条 → 当日 2 / 近 7 天 3（total 与 list 长度一致）。
 */
const HISTORY_OK = {
  status: 'success',
  data: {
    list: [
      {
        alertname: '主机 CPU 使用率过高',
        instance: '10.0.0.11:9100',
        network_domain: 'default',
        state: 'firing',
        fired_at: isoToday(),
        duration_seconds: 300,
        summary: 'CPU 使用率 92%，超过阈值 85% 已持续 5 分钟',
        value: '92',
      },
      {
        alertname: '接口错误率升高',
        instance: '10.0.0.13:9100',
        network_domain: 'default',
        state: 'resolved',
        fired_at: isoAgo(120),
        duration_seconds: 600,
        summary: '5xx 占比 4.2%，已恢复',
        value: '4.2',
      },
      {
        alertname: '磁盘空间不足',
        instance: '10.0.0.20:9100',
        network_domain: 'edge',
        state: 'resolved',
        fired_at: dayjs().subtract(3, 'day').toISOString(),
        duration_seconds: 900,
        summary: '数据盘使用率 91%，已清理',
        value: '91',
      },
    ],
    total: 3,
    page: 1,
    page_size: 200,
  },
}

const HISTORY_EMPTY = {
  status: 'success',
  data: { list: [], total: 0, page: 1, page_size: 200 },
}

describe('HomePage', () => {
  setupAntdTest()

  beforeEach(() => {
    mockGet.mockReset()
  })

  it('renders system status and dashboard overview from API response', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('版本 v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText('模式 standalone')).toBeInTheDocument()

    // 页面引导语（决策 72-2：页面归属由左侧导航/面包屑表达，页内不再重复大标题）
    expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()

    // 六张指标卡各自的数字（限定在卡片内断言，避免跨卡数字串扰）
    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
    })
    expect(within(screen.getByTestId('metric-resource_count')).getByText('10')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-monitored_count')).getByText('4')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-scrape_job_count')).getByText('3')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-scrape_job_count')).getByText('启用 2')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-domain_count')).getByText('2')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-pending_draft_count')).getByText('3')).toBeInTheDocument()
    // 采集覆盖率 = 已监控 4 ÷ 资源总数 10 = 40%
    expect(within(screen.getByTestId('metric-coverage')).getByText('40%')).toBeInTheDocument()

    // 最近下发记录
    expect(screen.getByText('CHG-001')).toBeInTheDocument()
    expect(screen.getByText('政务网A区')).toBeInTheDocument()
    // 下发状态用用户语言展示，不暴露枚举值 success
    expect(screen.getByText('成功')).toBeInTheDocument()
  })

  it('renders new dashboard layout blocks in order', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 六张关键指标卡：纯资产与治理进度（决策 72-3），不再包含告警维卡
    for (const key of METRIC_KEYS) {
      expect(screen.getByTestId(`metric-${key}`)).toBeInTheDocument()
    }
    expect(within(screen.getByTestId('metric-resource_count')).getByText('资源总数')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-monitored_count')).getByText('已监控')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-scrape_job_count')).getByText('采集 Job')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-domain_count')).getByText('已纳管网域')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('metric-pending_draft_count')).getByText('待确认草稿'),
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-coverage')).getByText('采集覆盖率')).toBeInTheDocument()

    // 告警治理态大卡片 + 快捷入口 / 最近下发分区 + 使用指引
    expect(screen.getByTestId('alert-status-card')).toBeInTheDocument()
    expect(screen.getByTestId('quick-access-card')).toBeInTheDocument()
    expect(screen.getByText('最近下发记录')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-steps-card')).toBeInTheDocument()

    // 自上而下顺序：标题区 → 指标卡网格 → 告警治理态大卡片 → 使用指引
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const title = screen.getByText(PAGE_INTRO)
    const metrics = screen.getByTestId('dashboard-card')
    const alertCard = screen.getByTestId('alert-status-card')
    const onboarding = screen.getByTestId('onboarding-steps-card')
    expect(following(title, metrics)).toBe(true)
    expect(following(metrics, alertCard)).toBe(true)
    expect(following(alertCard, onboarding)).toBe(true)
  })

  it('renders 查看全部 deep links on the alert card and the recent deployments card', async () => {
    setupHomeMock({ [AM_ALERTS_PATH]: AM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 告警卡标题右侧 → 告警中心（完整告警列表，首页只展示近 10 条）
    const alertCard = screen.getByTestId('alert-status-card')
    expect(within(alertCard).getByRole('link', { name: '查看全部 →' })).toHaveAttribute(
      'href',
      '/alert-status',
    )

    // 最近下发记录标题右侧 → 下发记录完整页（首页只展示最近 5 条）
    const deploymentCard = screen.getByText('最近下发记录').closest('.ant-card') as HTMLElement
    expect(deploymentCard).not.toBeNull()
    expect(within(deploymentCard).getByRole('link', { name: '查看全部 →' })).toHaveAttribute(
      'href',
      '/deployments',
    )
  })

  it('renders each latest alert as two rows with shallow severity tag and alert content', async () => {
    setupHomeMock({ [AM_ALERTS_PATH]: AM_ALERTS_OK, [HISTORY_PATH]: HISTORY_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const row = screen.getByTestId('latest-alert-0')
    // 行 1：级别 + 告警名 + 相对时间 + 状态（决策 73 两行制）
    const line1 = within(row).getByTestId('latest-alert-0-line1')
    expect(line1.style.display).toBe('flex')
    for (const text of ['严重', '主机 CPU 使用率过高', '5 分钟前', '通知中']) {
      expect(within(line1).getByText(text)).toBeInTheDocument()
    }

    // 行 2：实例名 · 告警具体内容（history summary 优先于 AM annotations.summary）
    const line2 = within(row).getByTestId('latest-alert-0-line2')
    expect(line2).toHaveTextContent('web-01 · CPU 使用率 92%，超过阈值 85% 已持续 5 分钟')
    expect(line2.textContent).not.toContain('AM 兜底内容')

    // 级别 Tag 浅底色 + 深字（决策 73），且配色**随皮肤 token 取值**而非写死字面量：
    // 双皮肤（火山青默认 / 仪电蓝）下语义红不同，断言必须按当前 token 走（见 skins.ts）
    expect(within(row).getByTestId('latest-alert-0-severity')).toHaveAttribute(
      'data-severity-tone',
      'critical',
    )
    const tokens = skinTokens(DEFAULT_SKIN)
    expect(within(row).getByTestId('latest-alert-0-severity').style.background).toBe(
      toRgbString(tokens.colorErrorBg),
    )
    expect(severityBg('critical', tokens)).toBe(tokens.colorErrorBg)
    expect(severityBg('warning', tokens)).toBe(tokens.colorWarningBg)
    expect(severityBg('info', tokens)).toBe(tokens.colorInfoBg)

    // 无 history 命中时回落 AM annotations.summary
    expect(screen.getByTestId('latest-alert-1-line2')).toHaveTextContent(
      'db-01 · 磁盘使用率 91%，预计 6 小时后写满',
    )
    // resource_name 缺失显示 '-'，且无告警内容时行 2 仅 '-'
    expect(screen.getByTestId('latest-alert-3-line2')).toHaveTextContent('-')
  })

  it('renders a scope note on every metric card with user-facing wording', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
    })

    for (const key of METRIC_KEYS) {
      expect(screen.getByTestId(`metric-tip-${key}`)).toBeInTheDocument()
    }

    // 悬浮 ⓘ 可读出中文口径说明（不得出现字段名 / 模块代号）
    fireEvent.mouseEnter(screen.getByTestId('metric-tip-monitored_count'))
    await waitFor(() => {
      expect(
        screen.getByText('至少被一个已启用的采集任务覆盖到的资源数。'),
      ).toBeInTheDocument()
    })
  })

  it('does not render any alert number inside the metric cards', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
    })

    renderPage()

    // 等告警卡渲染出最新告警，确保计数已到位
    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const grid = screen.getByTestId('dashboard-card')
    // 指标卡恰为 6 张（防止回归成换了标签的第 7 张告警数字卡；排除 ⓘ / 图标容器子节点）
    expect(within(grid).queryAllByTestId(/^metric-(?!tip-|icon-)/)).toHaveLength(6)
    expect(grid.textContent).not.toContain('通知中')
    expect(grid.textContent).not.toContain('已静默')
    expect(grid.textContent).not.toContain('Prometheus')
    expect(screen.queryByTestId('metric-notifying')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-silenced')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-prom_firing')).not.toBeInTheDocument()
  })

  it('renders placeholder instead of NaN when summary omits the new count fields', async () => {
    setupHomeMock({
      // 旧后端：响应缺少 monitored_count / scrape_job_count / scrape_job_enabled_count
      [DASHBOARD_PATH]: {
        status: 'success',
        data: {
          resource_count: 10,
          pending_draft_count: 3,
          domain_count: 2,
          recent_deployments: [],
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(within(screen.getByTestId('metric-resource_count')).getByText('10')).toBeInTheDocument()
    })

    // 字段缺失不得渲染 NaN% / 启用 undefined
    const grid = screen.getByTestId('dashboard-card')
    expect(grid.textContent).not.toContain('NaN')
    expect(grid.textContent).not.toContain('undefined')
    expect(within(screen.getByTestId('metric-monitored_count')).getByText('-')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-scrape_job_count')).getByText('-')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-coverage')).getByText('-')).toBeInTheDocument()
  })

  it('renders friendly empty state when there are no recent deployments', async () => {
    setupHomeMock({ [DASHBOARD_PATH]: DASHBOARD_EMPTY })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('暂无下发记录')).toBeInTheDocument()
    })
    // 无资源时采集覆盖率显示 '-'，不渲染 0%
    expect(within(screen.getByTestId('metric-coverage')).getByText('-')).toBeInTheDocument()
  })

  it('shows placeholder for every metric card when dashboard summary fails', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: { status: 'error', data: null, error: 'dashboard service unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('dashboard service unreachable')).toBeInTheDocument()
    })

    // 取数失败统一显示 '-'，不把失败静默成 0
    for (const key of METRIC_KEYS) {
      expect(within(screen.getByTestId(`metric-${key}`)).getByText('-')).toBeInTheDocument()
    }
  })

  it('renders error message when status API returns error status', async () => {
    setupHomeMock({
      [STATUS_PATH]: { status: 'error', data: null, error: 'status service unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('状态加载失败：status service unreachable')).toBeInTheDocument()
    })
  })

  it('renders error message when request throws', async () => {
    mockGet.mockRejectedValue(new Error('network failure'))

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('network failure').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('requests the 7d history window with the explicit fine-grained step', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith(HISTORY_PATH, expect.anything())
    })

    const call = mockGet.mock.calls.find(([path]) => path === HISTORY_PATH)
    const params = (call?.[1] as { params: Record<string, string | number> }).params

    // 决策 90：必须显式传步长，取值 30s —— 调用侧不因「宽窗口需要更粗步长」而放弃窄窗口的
    // 估算精度；7d 窗口下 20160 点超过 Prometheus 单序列 11000 点上限，由服务端
    // normalizeHistoryStep 抬高到 55s 兜底（2026-09-18 缺陷根因）
    expect(params.step).toBe(ALERT_HISTORY_STEP_SECONDS)
    // 常量取值 = PRD §5.4 默认步长 30s，且不低于最小步长 15s——两端都是产品口径，
    // 改动此常量即口径变更，须同步 PRD / 契约快照（宽窗口上限由服务端兜底承担）
    expect(ALERT_HISTORY_STEP_SECONDS).toBe(30)
    expect(ALERT_HISTORY_STEP_SECONDS).toBeGreaterThanOrEqual(15)

    // 窗口恰为 7d：服务端把 >7d 的窗口压缩为 [end-7d, end]，多加容差无效果
    const windowHours = (Date.parse(String(params.end)) - Date.parse(String(params.start))) / 3_600_000
    expect(windowHours).toBeCloseTo(7 * 24, 3)
    expect(params.page_size).toBe(200)
  })

  it('takes the week count from the server window total instead of the page', async () => {
    // 服务端窗口总量 350 > 单页上限 200：列表被截断，但「近 7 天」以窗口总量为准
    const todayItems = Array.from({ length: 200 }, (_, i) => ({
      alertname: `告警 ${i}`,
      instance: `10.0.0.${(i % 250) + 1}:9100`,
      network_domain: 'default',
      state: 'firing',
      fired_at: isoToday(),
      duration_seconds: 60,
      summary: '内容',
      value: '1',
    }))
    setupHomeMock({
      [HISTORY_PATH]: {
        status: 'success',
        data: { list: todayItems, total: 350, page: 1, page_size: 200, step: 60 },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('alert-today-count')).toHaveTextContent('200')
    })
    expect(screen.getByTestId('alert-week-count')).toHaveTextContent('350')
  })

  it('renders four-cell alert stat strip and the latest alerts list', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
      [HISTORY_PATH]: HISTORY_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const alertCard = screen.getByTestId('alert-status-card')
    const strip = screen.getByTestId('alert-stat-strip')
    // 主数字：当日 2 / 近 7 天 3（M02 history 按 fired_at 计数，含已恢复）
    expect(within(strip).getByTestId('alert-today-count')).toHaveTextContent('2')
    expect(within(strip).getByTestId('alert-week-count')).toHaveTextContent('3')
    // 次数字：通知中 = AM active 计数 3；已静默 · 已抑制合并为一格值串 '1 · 1'
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('3')
    expect(screen.getByTestId('alert-governed-count')).toHaveTextContent('1 · 1')
    for (const label of ['当日告警', '近 7 天告警', '通知中', '已静默 · 已抑制']) {
      expect(within(strip).getByText(label)).toBeInTheDocument()
    }
    // 四格数字统一 24px/700（等宽数字）
    const todayCount = screen.getByTestId('alert-today-count')
    expect(todayCount.style.fontSize).toBe('24px')
    expect(todayCount.style.fontWeight).toBe('700')
    expect(todayCount.style.fontVariantNumeric).toBe('tabular-nums')

    // 最新告警：近 8 条上限，标题与取数共用常量；两行制不再需要表头
    expect(within(alertCard).getByText('最新告警（近 8 条）')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-header')).not.toBeInTheDocument()

    expect(within(screen.getByTestId('latest-alert-0')).getByText('主机 CPU 使用率过高')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-1')).getByText('磁盘使用率接近上限')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-4')).getByText('节点失联')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-5')).not.toBeInTheDocument()
    expect(screen.queryByText('队列积压')).not.toBeInTheDocument()
    // 告警条数不超过单页上限（5 ≤ ALERT_PAGE_SIZE）→ 单页展示，分页器不出现
    expect(screen.queryByTestId('latest-alert-pager')).not.toBeInTheDocument()

    // 相对时间（本地化，非机器格式）
    expect(within(screen.getByTestId('latest-alert-0')).getByText('5 分钟前')).toBeInTheDocument()
    // resource_name 缺失显示 '-'，不回落成采集地址
    expect(within(screen.getByTestId('latest-alert-3')).getByText('-')).toBeInTheDocument()

    // 级别与通知状态用用户语言，不暴露枚举值
    expect(within(screen.getByTestId('latest-alert-4')).getByText('严重')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-0')).getByText('通知中')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-3')).getByText('已静默')).toBeInTheDocument()

    // unprocessed 不计数陈列，仅一行灰字防误读
    expect(screen.getByTestId('alert-unprocessed-note')).toHaveTextContent(
      '另有 1 条告警仍在计算通知状态',
    )

    // Prom 求值态仅作参考小字，且页面不再出现「待处理」歧义词
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 2')
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('求值中 1')
    expect(screen.queryByText(/待处理/)).not.toBeInTheDocument()

    // 卡内深链：告警中心入口已由标题右侧「查看全部 →」承担，底部不再重复（用户反馈 2026-09-14）
    expect(within(alertCard).queryByRole('link', { name: '查看告警中心 →' })).not.toBeInTheDocument()
    expect(within(alertCard).getByRole('link', { name: '配置告警通知' })).toHaveAttribute(
      'href',
      '/alert-config',
    )
  })

  it('caps the latest alert pool at 8 and paginates it at the fixed page size', async () => {
    // 12 条通知中告警：数据池上限仍为 8（决策 73 §3），卡内按固定页大小分页，其余走 /alert-status
    const items = Array.from({ length: 12 }, (_, i) => ({
      notify_status: 'active',
      labels: { alertname: `批量告警-${i}`, severity: 'warning', instance: `10.0.0.${i}:9100` },
      annotations: {},
      starts_at: isoAgo(i + 1),
      resource_name: `host-${i}`,
    }))
    setupHomeMock({
      [AM_ALERTS_PATH]: { status: 'success', data: { items } },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId(`latest-alert-${ALERT_PAGE_SIZE - 1}`)).toBeInTheDocument()
    })
    // 第 1 页恰为固定页大小条；池子外（≥ 8）与第 2 页条目都不渲染
    expect(screen.getAllByTestId(/^latest-alert-\d+$/)).toHaveLength(ALERT_PAGE_SIZE)
    expect(screen.queryByTestId(`latest-alert-${ALERT_PAGE_SIZE}`)).not.toBeInTheDocument()

    // 第 2 页承接池内剩余 3 条（8 - 5），池子上限 8 之外的仍不可见
    fireEvent.click(screen.getByTitle('2'))
    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-6')).toBeInTheDocument()
    })
    expect(screen.getByTestId('latest-alert-7')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-8')).not.toBeInTheDocument()
  })

  it('requests each alert endpoint exactly once for counts and the latest list', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
      [HISTORY_PATH]: HISTORY_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 三条只读链路各只请求一次（数字与列表同源，无重复取数）
    const paths = mockGet.mock.calls.map((call) => call[0] as string)
    expect(paths.filter((path) => path === AM_ALERTS_PATH)).toHaveLength(1)
    expect(paths.filter((path) => path === PROM_ALERTS_PATH)).toHaveLength(1)
    expect(paths.filter((path) => path === HISTORY_PATH)).toHaveLength(1)
    // 列表首条来自同一份响应
    expect(screen.getByTestId('latest-alert-0')).toHaveTextContent('主机 CPU 使用率过高')
  })

  it('does not show empty guidance when AM only has unprocessed alerts', async () => {
    setupHomeMock({
      [AM_ALERTS_PATH]: {
        status: 'success',
        data: {
          items: [
            {
              notify_status: 'unprocessed',
              labels: { alertname: '队列积压', severity: 'warning' },
              annotations: {},
              starts_at: isoAgo(1),
            },
          ],
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('alert-unprocessed-note')).toBeInTheDocument()
    })
    // 仅有 unprocessed 告警时不是空态：主数字 0 + 灰字提示，不得引导「去配置通知规则」
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('0')
    expect(screen.getByTestId('latest-alert-empty')).toBeInTheDocument()
    expect(screen.queryByText('当前无通知中的告警')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '去配置通知规则 →' })).not.toBeInTheDocument()
  })

  it('renders neutral empty guidance linking to /alert-config when both alert sources are empty', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_EMPTY,
      [AM_ALERTS_PATH]: AM_ALERTS_EMPTY,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('当前无通知中的告警')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: '去配置通知规则 →' })).toHaveAttribute(
      'href',
      '/alert-config',
    )
  })

  it('renders warning but keeps successful data when one alert source fails', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: Promise.reject(new Error('alerts unreachable')),
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('部分告警数据加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('alerts unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    // Prom 链路失败，但 AM 已成功的数据仍应展示（局部降级，不整卡报错）
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('3')
    expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
  })

  it('shows placeholder instead of 0 when the alertmanager source fails', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: Promise.reject(new Error('am down')),
      [HISTORY_PATH]: HISTORY_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('部分告警数据加载失败')).toBeInTheDocument()
    })

    // AM 侧失败 → 通知中 / 已静默 · 已抑制两格显示 '-'，不把失败静默成 0 让用户误当作真实值
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-governed-count')).toHaveTextContent('-')
    expect(screen.getByTestId('latest-alert-unavailable')).toBeInTheDocument()
    // history 侧成功 → 当日 / 近 7 天仍展示真实数字（局部降级不整片归零）
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('2')
    expect(screen.getByTestId('alert-week-count')).toHaveTextContent('3')
    // Prom 侧成功 → 参考行仍展示真实数字（局部降级不整片归零）
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 2')
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('求值中 1')
  })

  it('shows placeholder instead of 0 for today / week when the history source fails', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
      [HISTORY_PATH]: Promise.reject(new Error('history down')),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // history 取数失败 → 当日 / 近 7 天两格 '-'（不显示 0），不阻塞 AM / Prom 展示
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-week-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('3')
    expect(screen.getByTestId('alert-governed-count')).toHaveTextContent('1 · 1')
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 2')
    // 历史链路是辅助链路：不并入「告警状态加载失败」整卡错误态
    expect(screen.queryByText('告警状态加载失败')).not.toBeInTheDocument()
  })

  it('renders placeholder when the history envelope omits the list field', async () => {
    setupHomeMock({
      [HISTORY_PATH]: { status: 'success', data: { total: 5, page: 1, page_size: 200 } },
    })

    renderPage()

    // 字段缺失不得渲染 0，与取数失败同等降级为 '-'
    await waitFor(() => {
      expect(screen.getByTestId('alert-today-count')).toHaveTextContent('-')
    })
    expect(screen.getByTestId('alert-week-count')).toHaveTextContent('-')
    expect(screen.queryByText('去配置通知规则 →')).not.toBeInTheDocument()
  })

  it('renders error state when alert APIs return business error envelopes', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: { status: 'error', data: null, error: 'prom alerts failed' },
      [AM_ALERTS_PATH]: { status: 'error', data: null, error: 'alertmanager unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('告警状态加载失败')).toBeInTheDocument()
    })
    // 业务错误信封必须显式呈现，不得静默吞成 0 + 空态引导
    expect(screen.getByText(/alertmanager unreachable/)).toBeInTheDocument()
    expect(screen.queryByText('当前无通知中的告警')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('renders alert card error state with retry button', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: Promise.reject(new Error('alerts unreachable')),
      [AM_ALERTS_PATH]: Promise.reject(new Error('am down')),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('告警状态加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText(/alerts unreachable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('renders 5 quick access cards in a single flattened row with correct links', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('系统快速入口')).toBeInTheDocument()
    })

    const quickAccess = screen.getByTestId('quick-access-card')
    const links = [
      { name: '资源管理', href: '/resources' },
      { name: '采集 Job', href: '/scrape-jobs' },
      { name: '配置预览下发', href: '/config-preview' },
      { name: '指标查询', href: '/query' },
      { name: '告警状态', href: '/alert-status' },
    ]

    for (const { name, href } of links) {
      expect(within(quickAccess).getByRole('link', { name: new RegExp(name) })).toHaveAttribute(
        'href',
        href,
      )
    }

    // 一行五列压扁：单个 flex 行容器，5 项各 flex:1（描述移入 Tooltip，不再显式展示）
    const row = within(quickAccess).getByTestId('quick-access-row')
    expect(row.style.display).toBe('flex')
    expect(row.children).toHaveLength(5)
    for (const child of Array.from(row.children) as HTMLElement[]) {
      // 每项等分五列（等价 flex: 1 1 0，最小宽度 100px）
      expect(child.style.flexGrow).toBe('1')
      expect(child.style.flexShrink).toBe('1')
      expect(child.style.flexBasis).toBe('0px')
      expect(child.style.minWidth).toBe('100px')
    }
    expect(within(quickAccess).queryByText('维护主机、中间件与应用资源清单')).not.toBeInTheDocument()
  })

  it('puts the onboarding guide below the two-column row as a full-width card', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-steps-card')).toBeInTheDocument()
    })

    // 右列只承载 系统快速入口 → 最近下发记录（用户 2026-09-18 决策：使用指引移出右列）
    const rightColumn = screen.getByTestId('quick-access-card').closest('.ant-col') as HTMLElement
    expect(rightColumn).not.toBeNull()
    expect(within(rightColumn).getByText('最近下发记录')).toBeInTheDocument()
    expect(within(rightColumn).queryByTestId('onboarding-steps-card')).toBeNull()

    // 使用指引改为双列区**下方**的整宽一行：紧随双列 Row 之后，且不属于任何栅格列
    const onboarding = screen.getByTestId('onboarding-steps-card')
    const row = screen.getByTestId('alert-status-card').closest('.ant-row') as HTMLElement
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(following(row, onboarding)).toBe(true)
    expect(onboarding.closest('.ant-col')).toBeNull()
  })

  it('renders metric cards in a vertical layout with 30px value and 44px icon container', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
    })

    const card = screen.getByTestId('metric-resource_count')
    const value = within(card).getByText('10')
    // 数字 30px/800 + 等宽数字（决策 73：提高数字醒目度）
    expect(value.style.fontSize).toBe('30px')
    expect(value.style.fontWeight).toBe('800')
    expect(value.style.fontVariantNumeric).toBe('tabular-nums')
    // 图标容器 44px 圆角（内 22px 图标）
    const iconBox = within(card).getByTestId('metric-icon-resource_count')
    expect(iconBox.style.width).toBe('44px')
    expect(iconBox.style.height).toBe('44px')
    expect(iconBox.style.borderRadius).toBe('10px')
    // 卡内边距 14px 16px（决策 73 §4）；标签在数字之前（纵向排版）
    const cardBody = card.querySelector('.ant-card-body') as HTMLElement
    expect(cardBody.getAttribute('style')).toContain('padding: 14px 16px')
    expect(
      Boolean(
        within(card)
          .getByText('资源总数')
          .compareDocumentPosition(within(card).getByText('10')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
  })

  it('renders six onboarding steps with alert config and query deep links', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('使用指引')).toBeInTheDocument()
    })

    const onboarding = screen.getByTestId('onboarding-steps-card')
    expect(
      within(onboarding).getByText('按以下步骤完成首次监控闭环，大约需要 5 分钟'),
    ).toBeInTheDocument()

    expect(within(onboarding).getByRole('link', { name: '登记网域' })).toHaveAttribute(
      'href',
      '/domain-onboarding',
    )
    expect(within(onboarding).getByRole('link', { name: '导入资源' })).toHaveAttribute('href', '/resources')
    expect(within(onboarding).getByRole('link', { name: '建采集 Job' })).toHaveAttribute(
      'href',
      '/scrape-jobs',
    )
    expect(within(onboarding).getByRole('link', { name: '下发' })).toHaveAttribute('href', '/config-preview')
    // 第 5 步：配置告警通知 → /alert-config
    expect(within(onboarding).getByRole('link', { name: '配置告警通知' })).toHaveAttribute(
      'href',
      '/alert-config',
    )
    // 第 6 步：主入口 /query + 次入口 /alert-status
    expect(within(onboarding).getByRole('link', { name: '查指标' })).toHaveAttribute('href', '/query')
    expect(within(onboarding).getByRole('link', { name: '看告警' })).toHaveAttribute(
      'href',
      '/alert-status',
    )
  })

  it('lays the dashboard out by content height instead of pinning it to the viewport', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 页面根：纵向 flex 排布，但**不锁定视口高度**——不同电脑尺寸下不再被拉伸/压缩
    // （首版为「整页不出现下拉进度条」写过 height:100%，导致窄屏/少数据时卡片内大片留白）
    const page = screen.getByTestId('home-page')
    expect(page.style.display).toBe('flex')
    expect(page.style.flexDirection).toBe('column')
    expect(page.style.height).toBe('')
    expect(page.style.minHeight).toBe('')

    // 双列区：横向 flex 但**不吸收页面剩余高度**（不写 flex: 1 1 auto / min-height: 0）
    const alertCol = screen.getByTestId('alert-status-card').closest('.ant-col') as HTMLElement
    const row = alertCol.parentElement as HTMLElement
    const rowStyle = row.getAttribute('style') ?? ''
    expect(rowStyle).not.toContain('flex: 1 1 auto')
    expect(rowStyle).not.toContain('min-height: 0')
  })

  it('equalises the two columns with stretch + 420px min-height（方案乙：告警 5 行 ↔ 下发 6 条）', async () => {
    // 有真实告警数据（否则走空态引导，页脚不渲染）
    setupHomeMock({ [AM_ALERTS_PATH]: AM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const alertCard = screen.getByTestId('alert-status-card')
    const alertCol = alertCard.closest('.ant-col') as HTMLElement
    const rightCol = screen.getByTestId('quick-access-card').closest('.ant-col') as HTMLElement
    const row = alertCol.parentElement as HTMLElement

    // ① 内容对齐为主：告警 5 行/页 ↔ 最近下发 6 条（改任一侧常量都会破坏对齐）
    expect(ALERT_PAGE_SIZE).toBe(5)
    expect(rightCol.textContent).toContain('最近下发记录')

    // ② flex 兜底：两列 stretch 等高，差额由告警卡白底吸收；少告警时由 min-height 保住体量
    expect(row.style.alignItems).toBe('stretch')
    expect(row.style.minHeight).toBe('420px')
    expect(alertCard.style.height).toBe('100%')
    expect(alertCard.style.display).toBe('flex')

    // 右列内层同样撑满列高（gap 16 纵向排布），不留悬空高度
    const rightInner = rightCol.firstElementChild as HTMLElement
    expect(rightInner.style.display).toBe('flex')
    expect(rightInner.style.flexDirection).toBe('column')
    expect(rightInner.style.height).toBe('100%')

    // 告警卡：卡体为纵向 flex，页脚 margin-top:auto 贴卡底
    // → 落差落在「最新告警列表」下方（白底）而非卡片中段
    const alertBody = alertCard.querySelector('.ant-card-body') as HTMLElement
    expect(alertBody.style.display).toBe('flex')
    expect(alertBody.style.flexDirection).toBe('column')
    expect(screen.getByTestId('alert-card-footer').style.marginTop).toBe('auto')
  })

  it('paginates the latest alerts at a fixed page size, independent of the viewport', async () => {
    // 8 条通知中告警（恰为数据池上限）：单页固定 ALERT_PAGE_SIZE 行，第 2 页承接剩余 2 条。
    // 旧版按卡内实测高度反推行数（stub ResizeObserver 才能驱动），新版不再测量——不再 stub。
    const items = Array.from({ length: LATEST_ALERT_LIMIT }, (_, i) => ({
      notify_status: 'active',
      labels: { alertname: `批量告警-${i}`, severity: 'warning', instance: `10.0.0.${i}:9100` },
      annotations: {},
      starts_at: isoAgo(i + 1),
      resource_name: `host-${i}`,
    }))
    setupHomeMock({ [AM_ALERTS_PATH]: { status: 'success', data: { items } } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })
    // 单页行数 = 固定上限；分页器出现
    expect(screen.getAllByTestId(/^latest-alert-\d+$/)).toHaveLength(ALERT_PAGE_SIZE)
    expect(screen.getByTestId('latest-alert-pager')).toBeInTheDocument()
    expect(screen.getByTestId('latest-alert-0')).toHaveTextContent('批量告警-0')

    // 翻页：行序号沿用数据池全局序号，翻页后不重置、不重复
    fireEvent.click(screen.getByTitle('2'))
    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-6')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('latest-alert-0')).not.toBeInTheDocument()

    // 列表区不再是 flex 自适应容器（不测量高度、不 overflow 兜底）
    const region = screen.getByTestId('latest-alert-region')
    expect(region.style.display).toBe('')
  })

  it('does not render visualization screen entry', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    expect(screen.queryByText('可视化大屏')).not.toBeInTheDocument()
    expect(screen.queryByText('进入可视化大屏')).not.toBeInTheDocument()
  })
})
