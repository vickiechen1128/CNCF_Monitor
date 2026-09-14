import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'
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

/** 六张关键指标卡的 key（决策 72-3：纯资产与治理进度口径，不含告警数字） */
const METRIC_KEYS = [
  'resource_count',
  'monitored_count',
  'scrape_job_count',
  'domain_count',
  'pending_draft_count',
  'coverage',
]

/** 页面引导语：页内首行文案（决策 72-2；页面归属由导航表达，不重复「MetricCenter 概览」大标题） */
const PAGE_INTRO = '欢迎回到 MetricCenter，这里汇总监控资源、采集任务与告警的整体运行情况'

/** 相对当前时间构造 ISO 串，避免断言「N 分钟前」时依赖固定时间 */
const isoAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000).toISOString()

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
 */
const AM_ALERTS_OK = {
  status: 'success',
  data: {
    items: [
      {
        notify_status: 'active',
        labels: { alertname: '主机 CPU 使用率过高', severity: 'error' },
        annotations: {},
        starts_at: isoAgo(5),
        resource_name: 'web-01',
      },
      {
        notify_status: 'active',
        labels: { alertname: '磁盘使用率接近上限', severity: 'warning' },
        annotations: {},
        starts_at: isoAgo(30),
        resource_name: 'db-01',
      },
      {
        notify_status: 'active',
        labels: { alertname: '接口错误率升高', severity: 'info' },
        annotations: {},
        starts_at: isoAgo(120),
        resource_name: 'app-01',
      },
      {
        notify_status: 'silenced',
        labels: { alertname: '内存使用率偏高', severity: 'warning' },
        annotations: {},
        starts_at: isoAgo(180),
        resource_name: '',
      },
      {
        notify_status: 'inhibited',
        labels: { alertname: '节点失联', severity: 'critical' },
        annotations: {},
        starts_at: isoAgo(1440),
        resource_name: 'web-02',
      },
      {
        notify_status: 'unprocessed',
        labels: { alertname: '队列积压', severity: 'warning' },
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

  it('renders each latest alert as a single full-width row with five aligned fields', async () => {
    setupHomeMock({ [AM_ALERTS_PATH]: AM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const row = screen.getByTestId('latest-alert-0')
    // 五个字段同排（不再折成两行）：级别 · 告警名 · 实例名 · 相对时间 · 状态
    for (const text of ['严重', '主机 CPU 使用率过高', 'web-01', '5 分钟前', '通知中']) {
      expect(within(row).getByText(text)).toBeInTheDocument()
    }

    // 结构：List.Item 下仅一个 flex 行容器，直接子元素恰为 5 列（级别/告警名/实例名/时间/状态）
    const flexRow = row.querySelector('.ant-list-item > div') as HTMLElement
    expect(flexRow).not.toBeNull()
    expect(flexRow.style.display).toBe('flex')
    expect(flexRow.children).toHaveLength(5)
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
    // 指标卡恰为 6 张（防止回归成换了标签的第 7 张告警数字卡）
    expect(within(grid).queryAllByTestId(/^metric-(?!tip-)/)).toHaveLength(6)
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

  it('renders alert governance card with counts and the latest 10 alerts', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const alertCard = screen.getByTestId('alert-status-card')
    expect(within(alertCard).getAllByText('通知中').length).toBeGreaterThanOrEqual(1)
    // 主数字：AM notify_status === 'active' 计数 = 3
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('3')
    // 状态分布：已静默 / 已抑制 = 1 / 1，文案复用共享字典
    expect(screen.getByTestId('alert-silenced-count')).toHaveTextContent('1')
    expect(screen.getByTestId('alert-inhibited-count')).toHaveTextContent('1')

    // 最新告警：近 10 条，按 starts_at 倒序（unprocessed 不入列表）
    expect(within(alertCard).getByText('最新告警（近 10 条）')).toBeInTheDocument()

    // 表头：无表头时列义不可知（用户反馈 2026-09-14），列序固定 级别/告警名/实例名/时间/状态
    const header = screen.getByTestId('latest-alert-header')
    for (const col of ['级别', '告警名', '实例名', '时间', '状态']) {
      expect(within(header).getByText(col)).toBeInTheDocument()
    }

    expect(within(screen.getByTestId('latest-alert-0')).getByText('主机 CPU 使用率过高')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-0')).getByText('web-01')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-1')).getByText('磁盘使用率接近上限')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-4')).getByText('节点失联')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-5')).not.toBeInTheDocument()
    expect(screen.queryByText('队列积压')).not.toBeInTheDocument()

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

  it('caps the latest alert list at 10 rows, keeping the rest behind 查看全部', async () => {
    // 12 条通知中告警：卡内只渲染 10 行（决策 72-3 §3.4 上限），其余走 /alert-status
    const items = Array.from({ length: 12 }, (_, i) => ({
      notify_status: 'active',
      labels: { alertname: `批量告警-${i}`, severity: 'warning' },
      annotations: {},
      starts_at: isoAgo(i + 1),
      resource_name: `host-${i}`,
    }))
    setupHomeMock({
      [AM_ALERTS_PATH]: { status: 'success', data: { items } },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-9')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('latest-alert-10')).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/^latest-alert-\d+$/)).toHaveLength(10)
  })

  it('requests each alert endpoint exactly once for counts and the latest list', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 两条告警链路各只请求一次（数字与最新告警同源，无重复取数）
    const paths = mockGet.mock.calls.map((call) => call[0] as string)
    expect(paths.filter((path) => path === AM_ALERTS_PATH)).toHaveLength(1)
    expect(paths.filter((path) => path === PROM_ALERTS_PATH)).toHaveLength(1)
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
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('部分告警数据加载失败')).toBeInTheDocument()
    })

    // AM 侧失败 → 通知中 / 已静默 / 已抑制 显示 '-'，不把失败静默成 0 让用户误当作真实值
    expect(screen.getByTestId('alert-active-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-silenced-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-inhibited-count')).toHaveTextContent('-')
    expect(screen.getByTestId('latest-alert-unavailable')).toBeInTheDocument()
    // Prom 侧成功 → 参考行仍展示真实数字（局部降级不整片归零）
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 2')
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('求值中 1')
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

  it('renders 5 quick access cards with correct links', async () => {
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
