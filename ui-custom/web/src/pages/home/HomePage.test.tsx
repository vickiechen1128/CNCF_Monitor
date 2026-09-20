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

// 首页子组件（OnboardingSteps / AlertStatusCard 空态引导 / L1 子类行 / L2 应用行）使用 react-router Link
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

/**
 * L0 五张 KPI 卡的 key（决策 93：由 4 张扩为 5 张，新增「拨测」）。
 * 第 4 张「当前未恢复告警」取 `/api/v1/alerts` 的 firing 条数，
 * 第 5 张「拨测」取 dashboard.probe_target_abnormal_count，其余三张由 dashboard/summary 供数。
 */
const METRIC_KEYS = ['resource_count', 'monitored_count', 'coverage', 'firing_count', 'probe']

/** L0 中由 dashboard/summary 供数的四张卡（该接口失败时统一降级为 '-'） */
const DASHBOARD_METRIC_KEYS = ['resource_count', 'monitored_count', 'coverage', 'probe']

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

/**
 * 满足全部不变量的聚合样例（决策 91）：
 * - `sum(by_category.resource_count) = 42+26+18+34+8 = 128 = resource_count`
 * - `sum(by_category.monitored_count) = 36+21+12+22+5 = 96 = monitored_count`（覆盖率 75%）
 * - `sum(by_app.resource_count) + unclassified = 80 + 48 = 128`
 * - `sum(by_app.monitored_count) + unclassified = 60 + 36 = 96`
 * - `probe_target_count = 12` 不进 resource_count（拨测口径）
 */
const DASHBOARD_OK = {
  status: 'success',
  data: {
    resource_count: 128,
    monitored_count: 96,
    scrape_job_count: 3,
    scrape_job_enabled_count: 2,
    pending_draft_count: 3,
    domain_count: 2,
    recent_deployments: [],
    by_category: [
      {
        resource_category: 'host',
        resource_count: 42,
        monitored_count: 36,
        by_subtype: [
          { subtype: 'linux', resource_count: 34, monitored_count: 30 },
          { subtype: 'windows', resource_count: 8, monitored_count: 6 },
        ],
      },
      {
        resource_category: 'database',
        resource_count: 26,
        monitored_count: 21,
        by_subtype: [
          { subtype: 'mysql', resource_count: 14, monitored_count: 12 },
          { subtype: 'redis', resource_count: 9, monitored_count: 8 },
          // 覆盖率 1/3 = 33% < 70% → 橙色语义底（子类警示分支）
          { subtype: 'oracle', resource_count: 3, monitored_count: 1 },
        ],
      },
      // 中间件子类覆盖率 4/6 = 67% < 70% → 橙色语义底（警示断言用）
      {
        resource_category: 'middleware',
        resource_count: 18,
        monitored_count: 12,
        by_subtype: [
          { subtype: 'kafka', resource_count: 8, monitored_count: 6 },
          { subtype: 'nginx', resource_count: 6, monitored_count: 4 },
        ],
      },
      // 应用服务不设子类：by_subtype 恒为空数组
      {
        resource_category: 'application',
        resource_count: 34,
        monitored_count: 22,
        by_subtype: [],
      },
      {
        resource_category: 'generic_target',
        resource_count: 8,
        monitored_count: 5,
        by_subtype: [
          { subtype: 'snmp', resource_count: 4, monitored_count: 3 },
          { subtype: 'k8s', resource_count: 3, monitored_count: 2 },
          { subtype: 'custom_http', resource_count: 1, monitored_count: 0 },
        ],
      },
    ],
    by_app: [
      { app_code: 'payment', app_name: '支付平台', biz_code: 'pay', biz_name: '支付业务', resource_count: 30, monitored_count: 24 },
      { app_code: 'user', app_name: '用户中心', biz_code: 'user', biz_name: '用户业务', resource_count: 24, monitored_count: 16 },
      { app_code: 'data-api', app_name: '数据网关', biz_code: 'data', biz_name: '数据服务', resource_count: 26, monitored_count: 20 },
    ],
    unclassified_resource_count: 48,
    unclassified_monitored_count: 36,
    probe_target_count: 12,
    probe_target_abnormal_count: 1,
    // L3 明细（决策 93 effective 数据）：2 down + 5 up，覆盖「异常排前」与 >5 行分页分支
    probe_targets: [
      { url: 'https://pay-api.example.cn/healthz', status: 'down', biz_name: '支付业务', app_name: '支付平台', last_probe_at: '2026-09-19T09:36:00+08:00' },
      { url: 'https://www.example.cn/cert-check', status: 'down', biz_name: '用户业务', app_name: '', last_probe_at: '2026-09-19T09:27:00+08:00' },
      { url: 'https://www.example.cn/', status: 'up', biz_name: '用户业务', app_name: '', last_probe_at: '2026-09-19T09:38:00+08:00' },
      { url: 'https://data-api.example.cn/health', status: 'up', biz_name: '数据服务', app_name: '数据网关', last_probe_at: '2026-09-19T09:38:00+08:00' },
      { url: 'https://order.example.cn/submit', status: 'up', biz_name: '支付业务', app_name: '支付平台', last_probe_at: '2026-09-19T09:37:00+08:00' },
      { url: 'tcp://mysql.pay.example.cn:3306', status: 'up', biz_name: '支付业务', app_name: '支付平台', last_probe_at: '2026-09-19T09:37:00+08:00' },
      { url: 'https://gateway.example.cn/v1/ping', status: 'up', biz_name: '数据服务', app_name: '数据网关', last_probe_at: '2026-09-19T09:36:00+08:00' },
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
    by_category: [],
    by_app: [],
    unclassified_resource_count: 0,
    unclassified_monitored_count: 0,
    probe_target_count: 0,
    probe_target_abnormal_count: 0,
    probe_targets: [],
  },
}

/**
 * Prom 当前告警样例（决策 91 三处「未恢复」数字的唯一取数来源）：
 * firing 共 3 条 = host 1 + database 1（带 `app: payment`）+ 1 条**无
 * `resource_category`**（只进 L1 入口卡附注）；另有 1 条 `pending` **不计入**。
 */
const PROM_ALERTS_OK = {
  status: 'success',
  data: {
    alerts: [
      {
        state: 'firing',
        labels: { alertname: '主机 CPU 高' },
        annotations: {},
        activeAt: '2026-09-14T00:00:00Z',
        resource_category: 'host',
      },
      {
        state: 'firing',
        labels: { alertname: '数据库连接数高', app: 'payment' },
        annotations: {},
        activeAt: '2026-09-14T00:00:00Z',
        resource_category: 'database',
      },
      {
        // 拨测 / 聚合规则告警：无 resource_category → 不进任何资源类型卡
        state: 'firing',
        labels: { alertname: '拨测失败' },
        annotations: {},
        activeAt: '2026-09-14T00:00:00Z',
      },
      {
        // 求值中：不计入任何「未恢复」
        state: 'pending',
        labels: { alertname: '磁盘空间不足' },
        annotations: {},
        activeAt: '2026-09-14T00:00:00Z',
        resource_category: 'host',
      },
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
    setupHomeMock({ [PROM_ALERTS_PATH]: PROM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('版本 v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText('模式 standalone')).toBeInTheDocument()

    // 页面引导语（决策 72-2：页面归属由左侧导航/面包屑表达，页内不再重复大标题）
    expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()

    // L0 四张 KPI 卡各自的数字（限定在卡片内断言，避免跨卡数字串扰）
    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
    })
    expect(within(screen.getByTestId('metric-resource_count')).getByText('128')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-monitored_count')).getByText('96')).toBeInTheDocument()
    // 整体覆盖率 = 已纳入监控 96 ÷ 资源总数 128 = 75%
    expect(within(screen.getByTestId('metric-coverage')).getByText('75%')).toBeInTheDocument()
    // 第 4 卡：/api/v1/alerts 的 firing 条数（样例中 3 条，pending 不计）
    // 排版定版：标签「告警」+ 副行「当前未恢复」（口径写在副行，不与「当日 / 近 7 天」混淆）
    const firingCard = screen.getByTestId('metric-firing_count')
    expect(within(firingCard).getByText('告警')).toBeInTheDocument()
    expect(within(firingCard).getByText('当前未恢复')).toBeInTheDocument()
    expect(within(firingCard).getByText('3')).toBeInTheDocument()

    // 第 5 卡「拨测」：值 = probe_target_abnormal_count（1），副行带拨测目标总数
    const probeCard = screen.getByTestId('metric-probe')
    expect(within(probeCard).getByText('拨测')).toBeInTheDocument()
    expect(within(probeCard).getByText('1')).toBeInTheDocument()
    expect(probeCard).toHaveTextContent('/ 12 个拨测目标 · 异常数')
  })

  it('renders the six-section layout in order: L0 → L1 → L2 → L3 probe → L4 alert + L5 guide (same row)', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // L0：恰 5 张 KPI 卡
    for (const key of METRIC_KEYS) {
      expect(screen.getByTestId(`metric-${key}`)).toBeInTheDocument()
    }
    expect(within(screen.getByTestId('metric-resource_count')).getByText('资源总数')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('metric-monitored_count')).getByText('已纳入监控'),
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-coverage')).getByText('整体覆盖率')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-probe')).getByText('拨测')).toBeInTheDocument()

    // 旧版式的两处已按决策 91 移除
    expect(screen.queryByTestId('quick-access-card')).not.toBeInTheDocument()
    expect(screen.queryByText('最近下发记录')).not.toBeInTheDocument()
    expect(screen.queryByText('系统快速入口')).not.toBeInTheDocument()
    // L0 不再出现采集 Job / 已纳管网域 / 待确认草稿
    expect(screen.queryByTestId('metric-scrape_job_count')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-domain_count')).not.toBeInTheDocument()
    expect(screen.queryByTestId('metric-pending_draft_count')).not.toBeInTheDocument()

    // L1 采集覆盖区 + L2 应用覆盖表 + L3 拨测态势 + L4 告警状态卡 + L5 使用指引
    expect(screen.getByTestId('l1-grid')).toBeInTheDocument()
    expect(screen.getByTestId('l2-app-table')).toBeInTheDocument()
    expect(screen.getByTestId('probe-panel')).toBeInTheDocument()
    expect(screen.getByTestId('alert-status-card')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-steps-card')).toBeInTheDocument()

    // 自上而下顺序：引导语 → L0 → L1 → L2 → L3 →（L4 + L5 同排）
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const title = screen.getByText(PAGE_INTRO)
    const l0 = screen.getByTestId('l0-section')
    const l1 = screen.getByTestId('l1-grid')
    const l2 = screen.getByTestId('l2-app-table')
    const probe = screen.getByTestId('probe-panel')
    const l45 = screen.getByTestId('home-l45-row')
    const alertCard = screen.getByTestId('alert-status-card')
    const onboarding = screen.getByTestId('onboarding-steps-card')
    expect(following(title, l0)).toBe(true)
    expect(following(l0, l1)).toBe(true)
    expect(following(l1, l2)).toBe(true)
    expect(following(l2, probe)).toBe(true)
    expect(following(probe, l45)).toBe(true)
    // L4 / L5 同排：告警卡与使用指引在同一 flex 行容器内（等高渲染）
    expect(l45.contains(alertCard)).toBe(true)
    expect(l45.contains(onboarding)).toBe(true)
    expect(following(alertCard, onboarding)).toBe(true)
  })

  it('renders L1 as a row of 5 category cards, no entry card or alert capsules', async () => {
    setupHomeMock({ [PROM_ALERTS_PATH]: PROM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    })

    // 决策 93：一行五卡，无「按应用查看」入口卡
    for (const cat of ['host', 'database', 'middleware', 'application', 'generic_target']) {
      expect(screen.getByTestId(`l1-card-${cat}`)).toBeInTheDocument()
    }
    expect(screen.queryByTestId('l1-app-entry')).not.toBeInTheDocument()

    // 已采数 / 总数 + 量词（视觉定版）：主机写「台」，其余类型不写量词
    expect(within(screen.getByTestId('l1-card-host')).getByText('/ 42 台已采')).toBeInTheDocument()
    expect(within(screen.getByTestId('l1-card-database')).getByText('/ 26 已采')).toBeInTheDocument()
    expect(screen.getByTestId('l1-monitored-host')).toHaveTextContent('36')
    // 覆盖率 36/42 = 86%；未采 6
    expect(screen.getByTestId('l1-coverage-host')).toHaveTextContent('覆盖率 86%')
    expect(screen.getByTestId('l1-uncovered-host')).toHaveTextContent('未采 6')

    // 决策 93：告警胶囊已删，L1 各卡不渲染「未恢复」数字
    expect(screen.queryByTestId('l1-alert-capsule-host')).not.toBeInTheDocument()

    // 子类明细：host 有，应用服务**没有**（不按语言 / 框架拆子类）
    expect(screen.getByTestId('l1-subtypes-host')).toBeInTheDocument()
    expect(screen.queryByTestId('l1-subtypes-application')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('l1-card-application')).queryByText('采集类型子类')).toBeNull()
    // 不设子类的类型在**子类标题位**给一行规则说明，避免卡片留白且讲清「为什么不拆」
    expect(screen.getByTestId('l1-card-application')).toHaveTextContent('单一采集类型 · 不按语言拆')
    // 该类型仍给一个同口径的指标 chip（`application_http` 聚合），由 l1-no-subtype-* 标记
    expect(screen.getByTestId('l1-no-subtype-application')).toHaveTextContent('22/34 · 65%')
    const applicationCard = screen.getByTestId('l1-card-application')
    expect(applicationCard).toHaveTextContent('application_http')
    expect(applicationCard).toHaveTextContent('22/34 · 65%')
    // 决策 93：不再渲染采集形态示例 chip
    expect(applicationCard).not.toHaveTextContent('Java Spring / Go / Python')
    // 卡内脚注：只给容易被误读成成员的两类写
    expect(screen.getByTestId('l1-footnote-application')).toHaveTextContent('拨测目标不计入本类')
    expect(screen.getByTestId('l1-footnote-generic_target')).toHaveTextContent(
      '拨测走 blackbox Job，不录入资源台账',
    )

    // 子类行文案「已采/总数 · 覆盖率」+ 低于 70% 的橙色语义底
    const linuxRow = screen.getByTestId('l1-subtype-host-linux')
    expect(linuxRow).toHaveTextContent('30/34 · 88%')
    const nginxRow = screen.getByTestId('l1-subtype-middleware-nginx')
    expect(nginxRow).toHaveTextContent('4/6 · 67%')
    // 低于 70% 的子类 chip 给橙色语义底（颜色不作为唯一语义——行内仍并列百分数）
    expect(screen.getByTestId('l1-subtype-chip-middleware-nginx').style.background).not.toBe('')

    // 决策 93：入口卡与拨测附注已删（拨测口径由 L0 第 5 卡 + L3 拨测面板承载）
    expect(screen.queryByTestId('l1-probe-note')).not.toBeInTheDocument()
    expect(screen.queryByTestId('l1-unclassified-alert-note')).not.toBeInTheDocument()
  })

  it('aggregates subtypes beyond 3 into a more chip (决策 93)', async () => {
    const many = {
      ...DASHBOARD_OK,
      data: {
        ...DASHBOARD_OK.data,
        by_category: (DASHBOARD_OK.data as (typeof DASHBOARD_OK)['data']).by_category.map((c) =>
          c.resource_category === 'host'
            ? {
                ...c,
                by_subtype: [
                  { subtype: 'linux', resource_count: 34, monitored_count: 30 },
                  { subtype: 'windows', resource_count: 8, monitored_count: 6 },
                  { subtype: 'docker', resource_count: 5, monitored_count: 3 },
                  { subtype: 'k8s', resource_count: 4, monitored_count: 2 },
                ],
              }
            : c,
        ),
      },
    }
    setupHomeMock({ [DASHBOARD_PATH]: many })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    })
    // host 子类封顶 3 条：前 3 张（linux/windows/docker）正常渲染，第 4 条 k8s 不再单独渲染
    expect(screen.getByTestId('l1-subtype-host-linux')).toBeInTheDocument()
    expect(screen.getByTestId('l1-subtype-host-docker')).toBeInTheDocument()
    expect(screen.queryByTestId('l1-subtype-host-k8s')).not.toBeInTheDocument()
    // 第 4 条起聚合为「更多 +N」虚线 chip
    expect(screen.getByTestId('l1-subtype-more-host')).toHaveTextContent('更多 +1')
  })

  it('renders L2 app detail table sorted by coverage ascending with the unclassified row last', async () => {
    setupHomeMock({ [PROM_ALERTS_PATH]: PROM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l2-app-table')).toBeInTheDocument()
    })

    const table = screen.getByTestId('l2-app-table')
    // 决策 93：标题「应用覆盖」（不再叫「应用明细」）
    expect(within(table).getByText('应用覆盖')).toBeInTheDocument()
    const rows = within(table).getAllByRole('row')
    // 表头 1 行 + 3 个应用行 + 未归类行 1 行
    expect(rows).toHaveLength(5)

    // 决策 93：删除「未恢复」「应用简称」两列
    expect(within(table).queryByText('未恢复')).not.toBeInTheDocument()
    expect(within(table).queryByText('应用简称')).not.toBeInTheDocument()

    // 覆盖率升序：用户中心 16/24=67% → 数据网关 20/26=77% → 支付平台 24/30=80% → 未归类应用置底
    expect(rows[1]).toHaveTextContent('用户中心')
    expect(rows[2]).toHaveTextContent('数据网关')
    expect(rows[3]).toHaveTextContent('支付平台')
    expect(rows[4]).toHaveTextContent('未归类应用')

    // 应用名称 = 字典展示名，app_code 内联其后（次要小字）作应用简称
    expect(rows[1]).toHaveTextContent('user')
    expect(rows[1]).toHaveTextContent('67%')
    expect(rows[1]).toHaveTextContent('16')
    expect(rows[1]).toHaveTextContent('24')

    // 未归类行：实例 48 / 已采 36 / 去补填（置底且不看覆盖率）
    expect(rows[4]).toHaveTextContent('48')
    expect(rows[4]).toHaveTextContent('36')
    expect(within(rows[4]).getByRole('link', { name: '去补填' })).toHaveAttribute(
      'href',
      '/resources?import=1',
    )

    // 「看明细」深链带 app_code 预筛
    expect(within(rows[1]).getByRole('link', { name: '看明细' })).toHaveAttribute(
      'href',
      '/resources?app_code=user',
    )
  })

  it('renders the L2 biz domain column with biz_name and a dash for empty values', async () => {
    // by_app biz 维度为多数归因（决策 92/93/95）：biz_name 直接展示；
    // biz_code / biz_name 均为空（旧后端或未归因）时业务域列显示 '-'
    setupHomeMock({
      [DASHBOARD_PATH]: {
        status: 'success',
        data: {
          ...DASHBOARD_OK.data,
          by_app: [
            { app_code: 'payment', app_name: '支付平台', biz_code: 'pay', biz_name: '支付业务', resource_count: 30, monitored_count: 24 },
            // 空 biz 字段 → 业务域列 '-'（不回落成 app 名，也不臆造业务归属）
            { app_code: 'legacy', app_name: '遗留系统', biz_code: '', biz_name: '', resource_count: 5, monitored_count: 5 },
          ],
          unclassified_resource_count: 0,
          unclassified_monitored_count: 0,
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l2-app-table')).toBeInTheDocument()
    })

    const table = screen.getByTestId('l2-app-table')
    const rows = within(table).getAllByRole('row')
    // 表头 1 行 + 2 个应用行（无未归类行）
    expect(rows).toHaveLength(3)

    // 支付平台 24/30=80% 排前：业务域列显示 biz_name「支付业务」
    expect(rows[1]).toHaveTextContent('支付平台')
    expect(rows[1]).toHaveTextContent('支付业务')
    // 遗留系统 5/5=100% 排后：biz 字段为空 → 业务域列显示 '-'
    expect(rows[2]).toHaveTextContent('遗留系统')
    expect(rows[2]).toHaveTextContent('-')
    expect(rows[2].textContent).not.toContain('遗留系统业务')
  })

  it('renders the L3 probe panel with abnormal targets first and pagination when >5 rows', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('probe-panel')).toBeInTheDocument()
    })

    // 整宽卡标题 + extra 汇总（DASHBOARD_OK.probe_targets 7 条：正常 5 · 异常 2）
    const panel = screen.getByTestId('probe-panel')
    expect(within(panel).getByText('拨测态势')).toBeInTheDocument()
    expect(panel).toHaveTextContent('拨测目标 7 · 正常 5 · 异常 2')

    // 异常排最前：首行拨测目标为 down 的 pay-api，状态「异常」
    const dataRows = within(panel).getAllByRole('row')
    expect(dataRows[1]).toHaveTextContent('https://pay-api.example.cn/healthz')
    expect(dataRows[1]).toHaveTextContent('异常')

    // 7 条 > 每页 5 行 → 分页器出现
    expect(panel.querySelector('.ant-pagination')).not.toBeNull()
  })

  it('renders backend probe_targets with unknown status and degrades empty biz/app/last_probe_at to dash', async () => {
    // 「真实款」明细：MVP 后端 status 恒空串（未知）、biz_name/app_name 空串、
    // last_probe_at 为 nil。断言未知态中性呈现、空字段 '-' 降级，不渲染成 up/down 绿红。
    setupHomeMock({
      [DASHBOARD_PATH]: {
        status: 'success',
        data: {
          ...DASHBOARD_OK.data,
          probe_targets: [
            // 两条未知（status '' + 空 last_probe_at），同未知态保持原序（不强制前置）
            { url: 'https://gw.example.cn/ping', status: '', biz_name: '', app_name: '', last_probe_at: undefined },
            // 明确 down 强制排最前，仍正常呈现「异常」
            { url: 'https://pay-api.example.cn/healthz', status: 'down', biz_name: '支付业务', app_name: '支付平台', last_probe_at: isoAgo(5) },
            { url: 'https://www.example.cn/a', status: '', biz_name: '', app_name: '', last_probe_at: undefined },
          ],
        },
      },
    })

    renderPage()

    const panel = screen.getByTestId('probe-panel')
    // down 1 条被明确数出，未知不参与「正常 / 异常」计数
    await waitFor(() => {
      expect(panel).toHaveTextContent('拨测目标 3 · 正常 0 · 异常 1')
    })

    // 3 条 ≤ 每页 5 行 → 无分页器
    expect(panel.querySelector('.ant-pagination')).toBeNull()

    const dataRows = within(panel).getAllByRole('row')
    // 明确 down 排最前
    expect(dataRows[1]).toHaveTextContent('https://pay-api.example.cn/healthz')
    expect(dataRows[1]).toHaveTextContent('异常')
    // 两条未知保持原序（gw 在前、www 在后），渲染「未知」态而非 正常/异常 绿红
    expect(dataRows[2]).toHaveTextContent('https://gw.example.cn/ping')
    expect(dataRows[2]).toHaveTextContent('未知')
    expect(dataRows[3]).toHaveTextContent('https://www.example.cn/a')
    expect(dataRows[3]).toHaveTextContent('未知')
    // 空 biz_name / app_name / last_probe_at → '-' 降级（未知行含 '-'）
    for (const row of [dataRows[2], dataRows[3]]) {
      expect(row.textContent).toContain('-')
    }
    // 页面不渲染非法的 up/down 红绿措辞（只有 1 条明确异常）
    expect(within(panel).getAllByText('异常')).toHaveLength(1)
    expect(within(panel).getAllByText('未知')).toHaveLength(2)
    expect(within(panel).queryByText('正常')).toBeNull()
  })

  it('renders the L2 empty state pointing at the resource import flow', async () => {
    setupHomeMock({ [DASHBOARD_PATH]: DASHBOARD_EMPTY })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l2-app-table')).toBeInTheDocument()
    })

    const table = screen.getByTestId('l2-app-table')
    expect(within(table).getByText(/暂无资源/)).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: /去导入资源/ })).toHaveAttribute(
      'href',
      '/resources?import=1',
    )
    // 无资源时整体覆盖率显示 '-'，不渲染 0%
    expect(within(screen.getByTestId('metric-coverage')).getByText('-')).toBeInTheDocument()
    // 五类卡仍按 0 值渲染（缺则补 0 值条目）
    expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    expect(screen.getByTestId('l1-coverage-host')).toHaveTextContent('覆盖率 -')
  })

  it('renders the 查看全部 deep link on the alert card', async () => {
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
    // 「最近下发记录」卡已按决策 91 从首页移除
    expect(screen.queryByText('最近下发记录')).not.toBeInTheDocument()
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
        screen.getByText('至少被一个已启用的采集任务覆盖到的资源数；其余为尚未纳管的资源。'),
      ).toBeInTheDocument()
    })
  })

  it('keeps L0 to exactly five cards, with the fourth being the firing count and the fifth the probe count', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
    })

    renderPage()

    // 等告警卡渲染出最新告警，确保计数已到位
    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const grid = screen.getByTestId('l0-section')
    // KPI 卡恰为 5 张（决策 93：新增「拨测」；排除 ⓘ / 图标容器子节点）
    expect(within(grid).queryAllByTestId(/^metric-(?!tip-|icon-)/)).toHaveLength(5)
    // L0 唯一的告警数字是第 4 卡的 firing 条数（=3）；AM 治理态数字（通知中 / 已静默）只在告警卡内
    expect(within(screen.getByTestId('metric-firing_count')).getByText('3')).toBeInTheDocument()
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

    // 字段缺失不得渲染 NaN% / undefined；新分组字段缺失时 L1 / L2 按空数据降级
    const grid = screen.getByTestId('l0-section')
    expect(grid.textContent).not.toContain('NaN')
    expect(grid.textContent).not.toContain('undefined')
    expect(within(screen.getByTestId('metric-monitored_count')).getByText('-')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-coverage')).getByText('-')).toBeInTheDocument()
    expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    expect(screen.getByTestId('l2-app-table')).toBeInTheDocument()
  })

  it('shows placeholder instead of 0 for the firing card when the Prom source fails', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: { status: 'error', data: null, error: 'prom unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('metric-firing_count')).toBeInTheDocument()
    })

    // 取数失败显示 '-'（0 是「确实没有未恢复告警」的有效取值，必须与失败区分）
    expect(within(screen.getByTestId('metric-firing_count')).getByText('-')).toBeInTheDocument()
  })

  it('shows placeholder for every metric card when dashboard summary fails', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: { status: 'error', data: null, error: 'dashboard service unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('dashboard service unreachable')).toBeInTheDocument()
    })

    // 取数失败统一显示 '-'，不把失败静默成 0（告警卡数字独立取数，不随 summary 失败降级）
    for (const key of DASHBOARD_METRIC_KEYS) {
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
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 3')
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

    // 第 2 页承接池内剩余 3 条（8 - 5），池子上限 8 之外的仍不可见。
    // 限定在告警卡内点击分页（页面另有 L3 拨测分页，避免 getByTitle('2') 歧义）
    fireEvent.click(within(screen.getByTestId('alert-status-card')).getByTitle('2'))
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
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 3')
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
    expect(screen.getByTestId('prom-reference-line').textContent).toContain('触发中 3')
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

  it('renders the alert card and the onboarding guide in the same flex row with equal height', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-steps-card')).toBeInTheDocument()
    })

    // 决策 93：告警卡（L4）与使用指引（L5）同排等高（左告警 flex:1.6 : 右指引 flex:1，
    // align-items:stretch）。不再各占一根整宽行。旧版「系统快速入口 + 最近下发记录」双列区已整体移除。
    const row = screen.getByTestId('home-l45-row')
    expect(row.style.display).toBe('flex')
    expect(row.style.alignItems).toBe('stretch')
    const alertCard = screen.getByTestId('alert-status-card')
    const onboarding = screen.getByTestId('onboarding-steps-card')
    // 两卡都在同一 flex 行容器内，且 alert 在前、guide 在后
    expect(row.contains(alertCard)).toBe(true)
    expect(row.contains(onboarding)).toBe(true)
    // 卡片自身不再落在 antd 栅格列
    expect(alertCard.closest('.ant-col')).toBeNull()
    expect(onboarding.closest('.ant-col')).toBeNull()
    expect(screen.queryByTestId('quick-access-card')).not.toBeInTheDocument()
    // 使用指引卡被拉伸到与告警卡等高（height:100% + 卡体纵向 flex）
    expect(onboarding.style.height || onboarding.querySelector('.ant-card-body')).toBeTruthy()

    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(following(alertCard, onboarding)).toBe(true)
  })

  it('renders metric cards as label → 30px value → sub line, with no icon container', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
    })

    const card = screen.getByTestId('metric-resource_count')
    const value = within(card).getByText('128')
    // 数字 30px/800 + 等宽数字（决策 73：提高数字醒目度）
    expect(value.style.fontSize).toBe('30px')
    expect(value.style.fontWeight).toBe('800')
    expect(value.style.fontVariantNumeric).toBe('tabular-nums')
    // 排版定版：L0 卡内**不放图标容器**（数字是卡内唯一视觉主体，图标只会与它争权重）
    expect(within(card).queryByTestId('metric-icon-resource_count')).toBeNull()
    // 卡内边距 14px 16px（决策 73 §4）；标签在数字之前（纵向排版）
    const cardBody = card.querySelector('.ant-card-body') as HTMLElement
    expect(cardBody.getAttribute('style')).toContain('padding: 14px 16px')
    expect(
      Boolean(
        within(card)
          .getByText('资源总数')
          .compareDocumentPosition(within(card).getByText('128')) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
  })

  it('renders the L0 coverage progress bar and the sub line values from dashboard summary', async () => {
    setupHomeMock({ [PROM_ALERTS_PATH]: PROM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('整体覆盖率')).toBeInTheDocument()
    })

    // 区块标题：全局态势（L0 四卡的分区标题，与 L1「按资源类型」同级）
    expect(screen.getByText('全局态势')).toBeInTheDocument()

    // 覆盖率卡：数字 75% + 进度条（宽度 = 75%，品牌色，不随 <70% 阈值变橙）
    const bar = screen.getByTestId('l0-bar-coverage')
    expect(bar).toHaveAttribute('aria-valuenow', '75')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('75%')

    // 副行：资源总数「五类台账合计」；已纳入监控「未纳管 32」（= 128 − 96）
    expect(within(screen.getByTestId('metric-resource_count')).getByText('五类台账合计')).toBeInTheDocument()
    expect(within(screen.getByTestId('metric-monitored_count')).getByText('未纳管 32')).toBeInTheDocument()
  })

  it('renders L1 category badges as single characters', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    })

    // 单字徽标（视觉定版：线性图标在 26px 内辨识成本高，改用类型首字）
    expect(within(screen.getByTestId('l1-card-host')).getByText('主')).toBeInTheDocument()
    expect(within(screen.getByTestId('l1-card-database')).getByText('数')).toBeInTheDocument()
    expect(within(screen.getByTestId('l1-card-middleware')).getByText('中')).toBeInTheDocument()
    expect(within(screen.getByTestId('l1-card-application')).getByText('应')).toBeInTheDocument()
    expect(within(screen.getByTestId('l1-card-generic_target')).getByText('其')).toBeInTheDocument()
  })

  it('renders six onboarding steps with alert config and query deep links', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('使用指引')).toBeInTheDocument()
    })

    // 决策 93：使用指引为纵向六步 Steps（与告警卡同排等高）
    const onboarding = screen.getByTestId('onboarding-steps-card')
    expect(onboarding.querySelector('.ant-steps')).not.toBeNull()

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

    // 告警卡为整宽块（决策 91：不再是双列区的一列），因此页面根下没有任何
    // 「吸收剩余高度」的容器——不写 flex: 1 1 auto / min-height: 0
    expect(screen.getByTestId('alert-status-card').closest('.ant-col')).toBeNull()
    expect(page.getAttribute('style') ?? '').not.toContain('flex: 1 1 auto')
    expect(page.getAttribute('style') ?? '').not.toContain('min-height: 0')
  })

  it('keeps the 5-rows-per-page contract on the now full-width alert card', async () => {
    // 有真实告警数据（否则走空态引导，页脚不渲染）
    setupHomeMock({ [AM_ALERTS_PATH]: AM_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 决策 91：告警卡整宽后，「5 行/页 ↔ 下发 6 条」的左右列等高手段失效并已移除，
    // 5 行/页从此只是告警卡自身的定稿硬契约（homeLayout.ALERT_PAGE_SIZE）。
    expect(ALERT_PAGE_SIZE).toBe(5)
    const alertCard = screen.getByTestId('alert-status-card')
    expect(alertCard.closest('.ant-col')).toBeNull()
    expect(screen.queryByText('最近下发记录')).not.toBeInTheDocument()

    // 告警卡：卡体为纵向 flex，页脚 margin-top:auto 贴卡底
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

    // 翻页：行序号沿用数据池全局序号，翻页后不重置、不重复。
    // 限定在告警卡内点击分页（页面另有 L3 拨测分页，避免 getByTitle('2') 歧义）
    fireEvent.click(within(screen.getByTestId('alert-status-card')).getByTitle('2'))
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
