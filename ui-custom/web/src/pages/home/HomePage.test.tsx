import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HomePage } from './HomePage'
import { severityBg } from '../alerts/alertmanagerConstants'
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

const DASHBOARD_PATH = '/api/v2/platform/dashboard/summary'
/** M08 event 表当前未结告警（不分页，一次返回全部；与历史告警、首页四格同源） */
const CURRENT_ALERTS_PATH = '/api/v2/platform/alertmanager/alert-events/current'
/** M08 历史告警统计（首屏四格 + 当前未结计数） */
const STATS_PATH = '/api/v2/platform/alertmanager/alert-events/stats'

/**
 * 已下线的 L0 五张 KPI 卡的 key（反馈 11 已整块删除该区块）。
 * 常量保留为「反面清单」：用 `queryByTestId` 反向断言这些卡不再出现在首页，
 * 防止后续开发把已被裁定删除的版式悄悄加回来。
 */
const METRIC_KEYS = ['resource_count', 'monitored_count', 'coverage', 'firing_count', 'probe']

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
    [DASHBOARD_PATH]: DASHBOARD_OK,
    [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_EMPTY,
    [STATS_PATH]: STATS_EMPTY,
    ...overrides,
  })
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
    /**
     * 02「不同云的主机数量」样例（反馈 11 §11.2 ②③）：仅主机口径，云归属由
     * `Host.NetworkDomainID → NetworkDomain.CloudCode → CloudDict.CloudName` 派生（M06 权威链路）。
     * 自洽约束：各云 `resource_count` 之和 = host 类总数（42）。
     */
    by_cloud: [
      { cloud_code: 'PUB-TX', cloud_name: '腾讯云', resource_count: 30, monitored_count: 28, coverage_rate: 93 },
      { cloud_code: 'GM-CU', cloud_name: '政务云（联通）', resource_count: 12, monitored_count: 8, coverage_rate: 67 },
    ],
    /**
     * 03「平台与应用的主机分布」样例（反馈 11 §11.4）：仅统计 host。
     * 自洽约束（行列合计均等于主机总数 42 = `by_category[host].resource_count`）：
     * - 行合计：19 + 11 + 5 + 3 + 2 + 2 = 42
     * - 列合计：支付 16 + 用户 16 + 数据网关 7 + 未指定应用 3 = 42
     */
    by_platform_app: [
      {
        platform_code: 'k8s-prod',
        platform_name: '私有云A平台（容器云）',
        host_count: 19,
        cells: [
          { app_code: 'payment', app_name: '支付平台', host_count: 8 },
          { app_code: 'user', app_name: '用户中心', host_count: 7 },
          { app_code: 'data-api', app_name: '数据网关', host_count: 3 },
          { app_code: '', app_name: '未指定应用', host_count: 1 },
        ],
      },
      {
        platform_code: 'openstack',
        platform_name: '私有云B平台',
        host_count: 11,
        cells: [
          { app_code: 'payment', app_name: '支付平台', host_count: 5 },
          { app_code: 'user', app_name: '用户中心', host_count: 3 },
          { app_code: 'data-api', app_name: '数据网关', host_count: 2 },
          { app_code: '', app_name: '未指定应用', host_count: 1 },
        ],
      },
      {
        platform_code: 'aliyun',
        platform_name: '公有云A平台',
        host_count: 5,
        cells: [
          { app_code: 'payment', app_name: '支付平台', host_count: 2 },
          { app_code: 'user', app_name: '用户中心', host_count: 2 },
          { app_code: 'data-api', app_name: '数据网关', host_count: 1 },
        ],
      },
      {
        platform_code: 'aws',
        platform_name: '公有云B平台',
        host_count: 3,
        cells: [
          { app_code: 'payment', app_name: '支付平台', host_count: 1 },
          { app_code: 'user', app_name: '用户中心', host_count: 1 },
          { app_code: 'data-api', app_name: '数据网关', host_count: 1 },
        ],
      },
      {
        platform_code: '__other__',
        platform_name: '其他',
        host_count: 2,
        cells: [{ app_code: 'user', app_name: '用户中心', host_count: 2 }],
      },
      {
        platform_code: '',
        platform_name: '未指定平台',
        host_count: 2,
        cells: [
          { app_code: 'user', app_name: '用户中心', host_count: 1 },
          { app_code: '', app_name: '未指定应用', host_count: 1 },
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
    // L3 明细（决策 93 effective 数据）：2 down + 5 up，覆盖「异常排前」「归属网域」与短名单上限分支。
    // 按拨测对象分卡（2026-10-17 走查）：接口服务卡 6 条（2 down）+ 应用服务卡 2 条。
    probe_targets: [
      { service_name: '支付平台', resource_category: 'interface_service', url: 'https://pay-api.example.cn/healthz', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:36:00+08:00' },
      { service_name: '官网证书', resource_category: 'interface_service', url: 'https://www.example.cn/cert-check', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:27:00+08:00' },
      { service_name: '官网', resource_category: 'interface_service', url: 'https://www.example.cn/', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:38:00+08:00' },
      { service_name: '数据平台', resource_category: 'interface_service', url: 'https://data-api.example.cn/health', status: 'up', network_domain_id: 'mc-edge-debug', network_domain_name: '腾讯云调试域', last_probe_at: '2026-09-19T09:38:00+08:00' },
      { service_name: '订单中心', resource_category: 'interface_service', url: 'https://order.example.cn/submit', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
      { service_name: '库存服务', resource_category: 'interface_service', url: 'tcp://mysql.pay.example.cn:3306', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
      { service_name: '大模型应用', platform_names: '私有云A平台、私有云B平台', resource_category: 'application', url: 'http://10.0.0.5/health', status: 'up', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: '2026-09-19T09:37:00+08:00' },
      { service_name: '网关应用', platform_names: '公有云C平台', resource_category: 'application', url: 'https://gateway.example.cn/v1/ping', status: 'up', network_domain_id: 'mc-edge-debug', network_domain_name: '腾讯云调试域', last_probe_at: '2026-09-19T09:36:00+08:00' },
    ],
    // 采集健康三态：分母 = monitored_count = 96
    collection_health: {
      dispatched_count: 96,
      collecting_count: 80,
      partial_collecting_count: 8,
      down_count: 8,
    },
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
 * 当前告警样例（event 表未结三态）：告警中 3 / 静默中 1 / 抑制中 1，按 starts_at 倒序共 5 条。
 * 第 3 条 resource_name 为空，用于校验不回落成采集地址；summary 直接来自 event 行。
 */
const CURRENT_ALERTS_OK = {
  status: 'success',
  data: {
    list: [
      {
        id: 1,
        alert_name: '主机 CPU 使用率过高',
        status: 'firing',
        severity: 'error',
        summary: 'CPU 使用率 92%，超过阈值 85% 已持续 5 分钟',
        starts_at: isoAgo(5),
        updated_at: isoAgo(5),
        resource_name: 'web-01',
        instance_address: '10.0.0.11:9100',
      },
      {
        id: 2,
        alert_name: '磁盘使用率接近上限',
        status: 'firing',
        severity: 'warning',
        summary: '磁盘使用率 91%，预计 6 小时后写满',
        starts_at: isoAgo(30),
        updated_at: isoAgo(30),
        resource_name: 'db-01',
        instance_address: '10.0.0.12:9100',
      },
      {
        id: 3,
        alert_name: '接口错误率升高',
        status: 'firing',
        severity: 'info',
        summary: '',
        starts_at: isoAgo(120),
        updated_at: isoAgo(120),
        resource_name: '',
        instance_address: '10.0.0.13:9100',
      },
      {
        id: 4,
        alert_name: '内存使用率偏高',
        status: 'silenced',
        severity: 'warning',
        summary: '',
        starts_at: isoAgo(180),
        updated_at: isoAgo(180),
        resource_name: '',
        instance_address: '10.0.0.14:9100',
      },
      {
        id: 5,
        alert_name: '节点失联',
        status: 'inhibited',
        severity: 'critical',
        summary: '',
        starts_at: isoAgo(1440),
        updated_at: isoAgo(1440),
        resource_name: 'web-02',
        instance_address: '10.0.0.15:9100',
      },
    ],
    total: 5,
  },
}

const CURRENT_ALERTS_EMPTY = {
  status: 'success',
  data: { list: [], total: 0 },
}

/** 历史告警统计空态（首屏四格全 0）。 */
const STATS_EMPTY = {
  status: 'success',
  data: {
    today_total: 0,
    today_resolved_total: 0,
    today_resolved_real: 0,
    today_resolved_inferred: 0,
    open_total: 0,
    open_firing: 0,
    open_silenced: 0,
    open_inhibited: 0,
    legacy_open_total: 0,
    legacy_open_firing: 0,
    legacy_open_silenced: 0,
    legacy_open_inhibited: 0,
    legacy_resolved_today_total: 0,
    legacy_resolved_today_real: 0,
    legacy_resolved_today_inferred: 0,
  },
}

/** 历史告警统计样例：今日 2 / 今日恢复 3（2 真实 + 1 未知）/ 遗留 1 / 遗留今日恢复 1 / 未结 5。 */
const STATS_OK = {
  status: 'success',
  data: {
    today_total: 2,
    today_resolved_total: 3,
    today_resolved_real: 2,
    today_resolved_inferred: 1,
    open_total: 5,
    open_firing: 3,
    open_silenced: 1,
    open_inhibited: 1,
    legacy_open_total: 1,
    legacy_open_firing: 1,
    legacy_open_silenced: 0,
    legacy_open_inhibited: 0,
    legacy_resolved_today_total: 1,
    legacy_resolved_today_real: 1,
    legacy_resolved_today_inferred: 0,
  },
}

/**
 * 把视口 stub 成窄屏（≤767px）。
 * 只对首页断点查询返回 true——antd 内部的 `(min-width: ...)` 响应式查询仍为 false，
 * 避免顺带改变 antd 自身（如 Sider breakpoint）的判定。
 * afterEach 由 setupAntdTest 统一 unstubAllGlobals 还原。
 */
function stubNarrowViewport() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width: 767px'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

describe('HomePage', () => {
  setupAntdTest()

  beforeEach(() => {
    mockGet.mockReset()
    // 首页「资源管理」组隐藏偏好：跨测试隔离（localStorage 在同一测试文件内共享，
    // 不清则上一测试的隐藏态会污染后续测试的初值断言）
    window.localStorage.removeItem('metriccenter.home.resource-panels.collapsed')
  })

  it('renders the dashboard overview from API response', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    // 页面引导语（决策 72-2：页面归属由左侧导航/面包屑表达，页内不再重复大标题）
    expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()

    // 反馈 11：L0「全局态势感知」5 卡已整块删除，首屏不再出现任何孤立 KPI 数字
    expect(screen.queryByTestId('l0-section')).not.toBeInTheDocument()
    for (const key of METRIC_KEYS) {
      expect(screen.queryByTestId(`metric-${key}`)).not.toBeInTheDocument()
    }

    // 整体纳管完成率归口到 04 区块（首页唯一呈现点）：96 ÷ 128 = 75%
    await waitFor(() => {
      expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 96 / 共 128')
    })
    // 第五轮：百分比改圆环呈现——圆心文字（overall-coverage-percent）+ 圆环 aria-valuenow
    expect(screen.getByTestId('overall-coverage-percent')).toHaveTextContent('75%')
    expect(screen.getByTestId('overall-coverage-bar')).toHaveAttribute('aria-valuenow', '75')
    // 第五轮：页头「版本 / 模式」系统状态已按产品负责人要求去除（/api/v1/status 不再请求）
    expect(screen.queryByText(/^版本 /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^模式 /)).not.toBeInTheDocument()
    expect(mockGet).not.toHaveBeenCalledWith('/api/v1/status', expect.anything())
  })

  it('renders the layout in order: 02+03 row → 04 coverage → alert + health row → 05 probe → 06 guide', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 旧版式的入口卡 / 最近下发记录已按决策 91 移除
    expect(screen.queryByTestId('quick-access-card')).not.toBeInTheDocument()
    expect(screen.queryByText('最近下发记录')).not.toBeInTheDocument()
    expect(screen.queryByText('系统快速入口')).not.toBeInTheDocument()

    // 反馈 11：L0 整块删除，首屏无任何孤立 KPI 卡
    expect(screen.queryByTestId('l0-section')).not.toBeInTheDocument()
    for (const key of METRIC_KEYS) {
      expect(screen.queryByTestId(`metric-${key}`)).not.toBeInTheDocument()
    }

    // 八个区块锚点齐备
    expect(screen.getByTestId('cloud-distribution-panel')).toBeInTheDocument()
    expect(screen.getByTestId('platform-app-matrix-panel')).toBeInTheDocument()
    expect(screen.getByTestId('coverage-section')).toBeInTheDocument()
    expect(screen.getByTestId('home-alert-section')).toBeInTheDocument()
    expect(screen.getByTestId('home-collection-health-section')).toBeInTheDocument()
    expect(screen.getByTestId('home-probe-section')).toBeInTheDocument()
    expect(screen.getByTestId('collection-health-panel')).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding-section')).toBeInTheDocument()
    // design-proposal §2.4：应用覆盖明细表**已删除**（`l2-app-table` 不再出现在首页）
    expect(screen.queryByTestId('l2-app-table')).not.toBeInTheDocument()
    expect(screen.queryByText('应用覆盖明细表')).not.toBeInTheDocument()

    // 自上而下顺序（第六轮走查）：引导语 → 资源管理行（02 云 → 03 矩阵）→
    // 「04 纳管进度 + 告警」行 → 「采集健康 + 拨测」行 → 06 使用指引
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    const ordered = [
      screen.getByText(PAGE_INTRO),
      screen.getByTestId('cloud-distribution-panel'),
      screen.getByTestId('platform-app-matrix-panel'),
      screen.getByTestId('coverage-section'),
      screen.getByTestId('home-alert-section'),
      screen.getByTestId('home-collection-health-section'),
      screen.getByTestId('home-probe-section'),
      screen.getByTestId('home-onboarding-section'),
    ]
    ordered.slice(0, -1).forEach((node, i) => {
      expect(following(node, ordered[i + 1])).toBe(true)
    })

    // 资源管理行：02 + 03 两块同处一行（home-resource-row），云在前、矩阵在后；
    // **04 不在本行**（第六轮：04 改与告警并排）
    const resourceRow = screen.getByTestId('home-resource-row')
    expect(resourceRow).toContainElement(screen.getByTestId('cloud-distribution-panel'))
    expect(resourceRow).toContainElement(screen.getByTestId('platform-app-matrix-panel'))
    expect(resourceRow).not.toContainElement(screen.getByTestId('coverage-section'))

    // 「04 纳管进度 + 告警状态」一行；「采集健康 + 拨测态势」一行
    const coverageAlertRow = screen.getByTestId('home-coverage-alert-row')
    expect(coverageAlertRow).toContainElement(screen.getByTestId('coverage-section'))
    expect(coverageAlertRow).toContainElement(screen.getByTestId('home-alert-section'))
    const healthProbeRow = screen.getByTestId('home-health-probe-row')
    expect(healthProbeRow).toContainElement(screen.getByTestId('home-collection-health-section'))
    expect(healthProbeRow).toContainElement(screen.getByTestId('home-probe-section'))
    expect(
      following(
        screen.getByTestId('home-alert-section'),
        screen.getByTestId('home-collection-health-section'),
      ),
    ).toBe(true)

    // 告警卡与指引仍是两个独立块（反馈 11 §11.2 ⑦：不同排），旧同行容器已不存在
    expect(screen.queryByTestId('home-l45-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-alert-health-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-cloud-matrix-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('home-runtime-row')).not.toBeInTheDocument()
    expect(screen.getByTestId('alert-status-card')).toBeInTheDocument()
    expect(screen.getByTestId('onboarding-steps-card')).toBeInTheDocument()
  })

  it('renders one compact row per cloud with the host count only, between the intro and the 03 matrix', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 区块标题（2026-10-17 走查改标题：「按云主机数」不专业 →「不同云的主机数量」）。
    // 第六轮走查：口径速记（「按云分组 · 仅统计主机」）从卡头 extra 移入标题 Tooltip——
    // 02 收窄为 260px 窄列后「标题 + extra」同行放不下，标题被截断；移入 Tooltip 后
    // 标题完整可见（与 03 矩阵 / 04 卡头的 Tooltip 模式一致）
    const panel = screen.getByTestId('cloud-distribution-panel')
    expect(within(panel).getByText('不同云的主机数量')).toBeInTheDocument()
    expect(within(panel).getByLabelText('不同云的主机数量口径说明')).toBeInTheDocument()

    // 云名点击穿资源清单并按云预筛选（样例 PUB-TX / GM-CU）
    expect(within(panel).getByRole('link', { name: /腾讯云/ })).toHaveAttribute(
      'href',
      '/resources?cloud=PUB-TX',
    )
    expect(within(panel).getByRole('link', { name: /政务云（联通）/ })).toHaveAttribute(
      'href',
      '/resources?cloud=GM-CU',
    )

    // 每云一行（第五轮：KPI 卡 → 紧凑统计行）：云名 + 编码在左、台数在右（样例 30 / 12）
    expect(within(panel).getByTestId('cloud-cards')).toBeInTheDocument()
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
    // 紧凑行是普通 div（不再走 antd Row/Col 栅格）：云数 = 行数，宽窄屏同版式
    expect(panel.querySelectorAll('.ant-col')).toHaveLength(0)
    expect(within(panel).getAllByTestId(/^cloud-card-/)).toHaveLength(2)
    expect(screen.getByTestId('cloud-card-PUB-TX')).toHaveTextContent('腾讯云')
    expect(screen.getByTestId('cloud-card-PUB-TX')).toHaveTextContent('PUB-TX')
    expect(screen.getByTestId('cloud-host-count-PUB-TX')).toHaveTextContent('30')
    expect(screen.getByTestId('cloud-card-PUB-TX')).toHaveTextContent('台主机')
    expect(screen.getByTestId('cloud-host-count-GM-CU')).toHaveTextContent('12')

    // 合计行（第六轮走查新增）：各云主机台数之和 30 + 12 = 42，与 03 矩阵「合计」列同口径
    expect(screen.getByTestId('cloud-total-row')).toHaveTextContent('合计')
    expect(screen.getByTestId('cloud-total-count')).toHaveTextContent('42')
    expect(screen.getByTestId('cloud-total-row')).toHaveTextContent('台主机')

    // 反馈 11 §11.2 ⑤：云分布不再出现已下发 / 纳管率 / 进度条——首页唯一纳管率在 04 区块
    const panelText = panel.textContent ?? ''
    expect(panelText).not.toContain('已下发')
    expect(panelText).not.toContain('纳管率')
    expect(panelText).not.toContain('%')
    expect(within(panel).queryByRole('progressbar')).not.toBeInTheDocument()

    // 资源管理行（第六轮走查）：云分布 / 矩阵两块同处一行（flex-wrap 容器），
    // DOM 序云在前、矩阵在后——并排时矩阵在云右侧，堆叠时矩阵在云下方。
    // 04 纳管进度已移出本行（改与告警并排），但 DOM 序上仍紧随资源行之后
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(following(screen.getByText(PAGE_INTRO), panel)).toBe(true)
    expect(screen.getByTestId('home-resource-row')).toBeInTheDocument()
    expect(following(panel, screen.getByTestId('platform-app-matrix-panel'))).toBe(true)
    expect(following(screen.getByTestId('platform-app-matrix-panel'), screen.getByTestId('coverage-section'))).toBe(true)
  })

  it('closes the 03 matrix row and column totals on the same host grand total', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('pam-table')).toBeInTheDocument()
    })

    const panel = screen.getByTestId('platform-app-matrix-panel')
    // 2026-10-17 走查改标题：「平台 × 应用 · 主机数」的「×」与字段式写法领导读不懂
    expect(within(panel).getByText('平台与应用的主机分布')).toBeInTheDocument()
    // 度量单位为主机台数：行合计 = 列合计 = 主机总数 = 42（= host 类 resource_count）
    expect(screen.getByTestId('pam-grand-total')).toHaveTextContent('42')
    const rowTotals = ['k8s-prod', 'openstack', 'aliyun', 'aws', '__other__', 'unset'].map((code) =>
      Number(screen.getByTestId(`pam-row-total-${code}`).textContent),
    )
    expect(rowTotals).toEqual([19, 11, 5, 3, 2, 2])
    expect(rowTotals.reduce((a, b) => a + b, 0)).toBe(42)
    const colTotals = ['payment', 'user', 'data-api', 'unset'].map((code) =>
      Number(screen.getByTestId(`pam-col-total-${code}`).textContent),
    )
    expect(colTotals).toEqual([16, 16, 7, 3])
    expect(colTotals.reduce((a, b) => a + b, 0)).toBe(42)

    // 0 是有效计量值，照常渲染 0（不显示 '-'）
    expect(screen.getByTestId('pam-cell-aliyun-unset')).toHaveTextContent('0')
    // 「其他」聚合行与「未指定平台」兜底行附口径角标，且平台行不下钻（资源页不支持 platform_code）
    expect(within(screen.getByTestId('pam-row-__other__')).getByText('聚合')).toBeInTheDocument()
    expect(within(screen.getByTestId('pam-row-unset')).getByText('待补录')).toBeInTheDocument()
    // 矩阵行不可下钻；面板内唯一链接 = 脚注的台账补录引导（§2.4 遗留补偿，指向资源页导入）
    const panelLinks = within(panel).queryAllByRole('link')
    expect(panelLinks).toHaveLength(1)
    expect(panelLinks[0]).toHaveAttribute('href', '/resources?import=1')
  })

  it('renders the matrix unavailable state instead of an all-zero table when by_platform_app is missing', async () => {
    const dataWithoutMatrix: Record<string, unknown> = { ...DASHBOARD_OK.data }
    delete dataWithoutMatrix.by_platform_app
    setupHomeMock({ [DASHBOARD_PATH]: { ...DASHBOARD_OK, data: dataWithoutMatrix } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('platform-app-matrix-panel')).toBeInTheDocument()
    })
    expect(screen.getByTestId('pam-unavailable')).toBeInTheDocument()
    // 绝不渲染全 0 矩阵：0 与「取数失败」必须区分
    expect(screen.queryByTestId('pam-table')).not.toBeInTheDocument()
  })

  it('renders the cloud panel empty state guiding to host import when by_cloud is empty', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: { ...DASHBOARD_OK, data: { ...DASHBOARD_OK.data, by_cloud: [] } },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    const panel = screen.getByTestId('cloud-distribution-panel')
    expect(within(panel).getByText('暂无主机数据')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: /去导入主机资源/ })).toHaveAttribute('href', '/resources')
  })

  it('prefers backend by_cloud over the static sample and drops the removed coverage figures', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: {
        ...DASHBOARD_OK,
        data: {
          ...DASHBOARD_OK.data,
          by_cloud: [
            { cloud_code: 'PUB-TX', cloud_name: '腾讯云', resource_count: 40, monitored_count: 39, coverage_rate: 98 },
            { cloud_code: 'IND-TX', cloud_name: '行业云（腾讯）', resource_count: 2, monitored_count: 1, coverage_rate: 50 },
          ],
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    const panel = screen.getByTestId('cloud-distribution-panel')
    // 后端数据覆盖静态样例（不出现样例的 GM-CU 政务云 12）
    expect(within(panel).getByText('行业云（腾讯）')).toBeInTheDocument()
    expect(screen.getByTestId('cloud-host-count-PUB-TX')).toHaveTextContent('40')
    expect(screen.getByTestId('cloud-host-count-IND-TX')).toHaveTextContent('2')
    expect(within(panel).queryByText('政务云（联通）')).not.toBeInTheDocument()
    // coverage_rate 仍在响应里，但云卡不呈现（纳管率唯一呈现点在 04）
    const panelText = panel.textContent ?? ''
    expect(panelText).not.toContain('98%')
    expect(panelText).not.toContain('50%')
    expect(panelText).not.toContain('67%')
  })

  it('renders the 未指定云 cloud card without a drill-down link', async () => {
    // §2.1 第 6 条：`cloud_code` 为空串的「未指定云」卡不可下钻——空参与无参在资源页
    // 不可区分，链过去等于「点了却没按云筛」的假动作，与矩阵「未指定平台」行同口径。
    setupHomeMock({
      [DASHBOARD_PATH]: {
        ...DASHBOARD_OK,
        data: {
          ...DASHBOARD_OK.data,
          by_cloud: [
            { cloud_code: 'PUB-TX', cloud_name: '腾讯云', resource_count: 30, monitored_count: 28, coverage_rate: 93 },
            { cloud_code: '', cloud_name: '未指定云', resource_count: 12, monitored_count: 8, coverage_rate: 67 },
          ],
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('cloud-card-')).toBeInTheDocument()
    })

    // 有云编码的卡仍深链 /resources?cloud=<code>
    expect(screen.getByTestId('cloud-card-PUB-TX').querySelector('a')).toHaveAttribute(
      'href',
      '/resources?cloud=PUB-TX',
    )
    // 未指定云卡：卡内**无链接**（云名降级为普通文本 + 说明），主机台数照常呈现
    const unsetCard = screen.getByTestId('cloud-card-')
    expect(unsetCard.querySelector('a')).toBeNull()
    expect(unsetCard).toHaveTextContent('未指定云')
    expect(screen.getByTestId('cloud-host-count-')).toHaveTextContent('12')
  })

  it('renders the 采集健康 panel (four states) in the health-probe row, beside the probe panel', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    const panel = screen.getByTestId('collection-health-panel')
    expect(within(panel).getByText('采集健康')).toBeInTheDocument()

    // 三态计数（分母 = 已选中资源数 96，不含「未监控」）
    expect(screen.getByTestId('ch-legend-collecting_count')).toHaveTextContent('采集中')
    expect(screen.getByTestId('ch-legend-collecting_count')).toHaveTextContent('80')
    expect(screen.getByTestId('ch-legend-partial_collecting_count')).toHaveTextContent('部分采集中')
    expect(screen.getByTestId('ch-legend-partial_collecting_count')).toHaveTextContent('8')
    expect(screen.getByTestId('ch-legend-down_count')).toHaveTextContent('已下发未采到')
    expect(screen.getByTestId('ch-legend-down_count')).toHaveTextContent('8')

    // 分布条 + 深链 M07 资源明细（第六轮走查：入口文案改「查看资源采集健康状态」）
    expect(screen.getByTestId('ch-bar')).toBeInTheDocument()
    expect(within(panel).getByTestId('ch-detail-link')).toHaveTextContent('查看资源采集健康状态')
    expect(within(panel).getByTestId('ch-detail-link')).toHaveAttribute('href', '/resources')

    expect(screen.getByTestId('ch-legend').style.display).toBe('grid')
    expect(screen.getByTestId('ch-legend').style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
    expect(within(screen.getByTestId('ch-legend')).getAllByTestId(/^ch-legend-/)).toHaveLength(3)

    // 位置（第六轮走查定）：与拨测态势同处 home-health-probe-row（采集左、拨测右），
    // 整行之上是「04 + 告警」行，整行之下是 06 使用指引
    const row = screen.getByTestId('home-health-probe-row')
    expect(row).toContainElement(panel)
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(following(screen.getByTestId('home-alert-section'), panel)).toBe(true)
    expect(following(panel, screen.getByTestId('probe-panel'))).toBe(true)
    expect(following(screen.getByTestId('probe-panel'), screen.getByTestId('home-onboarding-section'))).toBe(true)
  })

  it('renders the 采集健康 unavailable state (never a false 0) when collection_health is absent', async () => {
    const dataWithoutHealth: Record<string, unknown> = { ...DASHBOARD_OK.data }
    delete dataWithoutHealth.collection_health
    setupHomeMock({ [DASHBOARD_PATH]: { ...DASHBOARD_OK, data: dataWithoutHealth } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('collection-health-panel')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ch-unavailable')).toBeInTheDocument()
    // 字段缺失时不渲染分布条，避免把「不可用」误报成 0
    expect(screen.queryByTestId('ch-bar')).not.toBeInTheDocument()
  })

  it('renders the 采集健康 empty guide when dispatched_count is 0', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: {
        ...DASHBOARD_OK,
        data: {
          ...DASHBOARD_OK.data,
          collection_health: {
            dispatched_count: 0,
            collecting_count: 0,
            down_count: 0,
          },
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('collection-health-panel')).toBeInTheDocument()
    })
    expect(screen.getByTestId('ch-empty-link')).toHaveAttribute('href', '/scrape-jobs')
    expect(screen.queryByTestId('ch-bar')).not.toBeInTheDocument()
  })

  it('stacks the cloud rows and the matrix keeps its table on the mobile viewport', async () => {
    stubNarrowViewport()
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 02 按云主机数 → 已改名「不同云的主机数量」：窄屏仍是紧凑统计行（一行一云），不渲染表格。
    // 第五轮起云分布宽窄屏同版式（竖排行不依赖横向空间），故不再有 ant-col 栅格分支
    const cloudPanel = screen.getByTestId('cloud-distribution-panel')
    expect(within(cloudPanel).getByTestId('cloud-cards')).toBeInTheDocument()
    expect(within(cloudPanel).queryByRole('table')).not.toBeInTheDocument()
    expect(cloudPanel.querySelectorAll('.ant-col')).toHaveLength(0)
    expect(within(cloudPanel).getAllByTestId(/^cloud-card-/)).toHaveLength(2)
    expect(screen.getByTestId('cloud-card-PUB-TX')).toHaveTextContent('腾讯云')
    expect(screen.getByTestId('cloud-card-PUB-TX')).toHaveTextContent('台主机')

    // 03 矩阵：**不卡片化**——保留二维表格（纵向滚动 + 首列固定），否则失去行列可比性
    const matrix = screen.getByTestId('platform-app-matrix-panel')
    expect(within(matrix).getByRole('table')).toBeInTheDocument()
    // 面板内唯一链接 = 脚注的台账补录引导（§2.4 遗留补偿），平台行本身不下钻
    const matrixLinks = within(matrix).queryAllByRole('link')
    expect(matrixLinks).toHaveLength(1)
    expect(matrixLinks[0]).toHaveAttribute('href', '/resources?import=1')

    // 应用覆盖明细表已删除：窄屏也不再有应用覆盖卡片
    expect(screen.queryByTestId('l2-app-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('l2-app-cards')).not.toBeInTheDocument()
  })

  it('renders the L1 coverage table inside the 04 card, one row per category, no entry card or alert capsules', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    })

    // 第五轮：六张平级卡 → 04 卡片内的一张六行表格（与整体圆环同卡，构成共同体）
    for (const cat of ['host', 'database', 'middleware', 'application', 'interface_service', 'generic_target']) {
      expect(screen.getByTestId(`l1-card-${cat}`)).toBeInTheDocument()
    }
    expect(screen.queryByTestId('l1-app-entry')).not.toBeInTheDocument()
    const coverageCard = screen.getByTestId('coverage-card')
    expect(coverageCard).toContainElement(screen.getByTestId('l1-card-host'))
    expect(coverageCard).toContainElement(screen.getByTestId('overall-coverage-bar'))
    // 采集任务入口（第六轮走查）：深链预筛 job_type=standard（采集类型，与拨测 blackbox 分开）
    expect(within(coverageCard).getByRole('link', { name: '查看采集任务 →' })).toHaveAttribute(
      'href',
      '/scrape-jobs?job_type=standard',
    )

    // 列值：已配置采集 36 / 总数 42；纳管率 86%；未配置采集 6
    expect(screen.getByTestId('l1-monitored-host')).toHaveTextContent('36')
    // 单位已去除（第六轮走查）：表头已说明是「采集」，列内只留数字
    expect(screen.getByTestId('l1-monitored-host').textContent).not.toContain('台')
    expect(screen.getByTestId('l1-total-host')).toHaveTextContent('42')
    expect(screen.getByTestId('l1-coverage-host')).toHaveTextContent('86%')
    expect(screen.getByTestId('l1-uncovered-host')).toHaveTextContent('6')
    // 非主机类同样只留数字
    expect(screen.getByTestId('l1-monitored-database')).toHaveTextContent('21')
    expect(screen.getByTestId('l1-monitored-database').textContent).not.toContain('台')
    // 未登记该类对象（mock 无 interface_service）→ 计数列一律 '-',不写 0（第六轮走查）
    expect(screen.getByTestId('l1-monitored-interface_service')).toHaveTextContent('-')
    expect(screen.getByTestId('l1-total-interface_service')).toHaveTextContent('-')
    expect(screen.getByTestId('l1-uncovered-interface_service')).toHaveTextContent('-')
    expect(screen.getByTestId('l1-coverage-interface_service')).toHaveTextContent('-')

    // 决策 93：告警胶囊已删，L1 各卡不渲染「未恢复」数字
    expect(screen.queryByTestId('l1-alert-capsule-host')).not.toBeInTheDocument()

    // 2026-10-17 走查：「采集方式细分」子类区**整块去除**——子类 chip、规则说明、
    // 卡内脚注、子类深链一并移除；类型行只留总数口径（已下发数 + 纳管率）。
    // 子类下钻动线归资源清单页（/resources 自带类型 / 子类筛选），不在首页重复。
    for (const cat of ['host', 'database', 'middleware', 'application', 'interface_service', 'generic_target']) {
      const row = screen.getByTestId(`l1-card-${cat}`)
      expect(row).not.toHaveTextContent('采集方式细分')
      expect(row).not.toHaveTextContent('linux')
      expect(row).not.toHaveTextContent('application_http')
      expect(row).not.toHaveTextContent('拨测')
      expect(within(row).queryByTestId(`l1-subtypes-${cat}`)).not.toBeInTheDocument()
      expect(within(row).queryByTestId(`l1-no-subtype-${cat}`)).not.toBeInTheDocument()
      expect(within(row).queryByTestId(`l1-footnote-${cat}`)).not.toBeInTheDocument()
    }
    // 子类 chip 的深链动线一并移除：卡内不再出现 /resources?resource_category=...&subtype=...
    expect(screen.queryByRole('link', { name: /linux/ })).not.toBeInTheDocument()

    // 决策 93：入口卡与拨测附注已删（拨测口径由 05 段两张拨测卡承载）
    expect(screen.queryByTestId('l1-probe-note')).not.toBeInTheDocument()
    expect(screen.queryByTestId('l1-unclassified-alert-note')).not.toBeInTheDocument()
  })

  it('orders 接口服务 above 其他监控目标 in the L1 table', async () => {
    // 第五轮产品负责人裁定：「其他监控目标」是兜底聚合类（snmp / k8s / custom_http 混排），
    // 与「未指定」同类属读表居末的收尾类；具体的「接口服务」应排在它之上。
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('l1-card-interface_service')).toBeInTheDocument()
    })

    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    // 完整顺序：主机 → 数据库 → 中间件 → 应用服务 → 接口服务 → 其他监控目标
    const order = ['host', 'database', 'middleware', 'application', 'interface_service', 'generic_target']
    order.slice(0, -1).forEach((cat, i) => {
      expect(following(screen.getByTestId(`l1-card-${cat}`), screen.getByTestId(`l1-card-${order[i + 1]}`))).toBe(true)
    })
  })

  it('drops the subtype breakdown from the L1 rows even when the API returns subtypes', async () => {
    // 2026-10-17 走查：契约字段 by_subtype 仍在（后端不变、样例返回 4 条），
    // 但首页类型行不再消费——防止「子类全量展示」旧口径被悄悄加回来。
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

    const hostRow = screen.getByTestId('l1-card-host')
    // 任何子类名 / 子类标题 / 子类锚点都不再出现在类型行上
    for (const sub of ['linux', 'windows', 'docker', 'k8s']) {
      expect(hostRow).not.toHaveTextContent(sub)
    }
    expect(hostRow).not.toHaveTextContent('采集方式细分')
    expect(within(hostRow).queryByTestId('l1-subtypes-host')).not.toBeInTheDocument()
    // 总数口径照常：已配置采集 36 / 总数 42（单位已去除，列内只留数字）
    expect(hostRow).toHaveTextContent('36')
    expect(hostRow).not.toHaveTextContent('36 台')
    expect(screen.getByTestId('l1-total-host')).toHaveTextContent('42')
    expect(screen.getByTestId('l1-monitored-host')).toHaveTextContent('36')
  })

  it('renders the probe area as one card with two sub-sections, overall stats and a /scrape-jobs link', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('probe-panel')).toBeInTheDocument()
    })

    // 区头（第六轮走查后进卡头）：标题 + 深链；原「拨测目标 N · 正常 X · 异常 Y · 未知 Z」
    // 汇总行按产品负责人要求移除，整体情况改由卡内左列「正常率」圆环承载
    const panel = screen.getByTestId('probe-panel')
    expect(within(panel).getByText('拨测态势')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: '查看异常拨测目标 →' })).toBeInTheDocument()
    expect(panel).not.toHaveTextContent('拨测目标 8 · 正常 6 · 异常 2')
    // 整体健康度「正常率」圆环（仿 04 整体圆环样式）：6/8 = 75%
    expect(screen.getByTestId('probe-health-rate-percent')).toHaveTextContent('75%')
    expect(screen.getByTestId('probe-health-rate')).toHaveAttribute('aria-label', '拨测正常率 75%')
    expect(screen.getByTestId('probe-health-rate-value')).toHaveTextContent('正常 6 / 共 8')
    expect(within(panel).getByText('正常率')).toBeInTheDocument()

    // 第六轮走查：区头与两个子版面**合为一张卡**——子版面是卡内浅底分区（不再是独立 SurfaceCard），
    // 分区标题 + 一句自解释 hint 保留
    const ifaceSection = screen.getByTestId('probe-section-interface_service')
    const appSection = screen.getByTestId('probe-section-application')
    expect(within(ifaceSection).getByText('接口服务探活')).toBeInTheDocument()
    expect(ifaceSection).toHaveTextContent('业务接口能否正常访问')
    expect(within(appSection).getByText('应用服务探活')).toBeInTheDocument()
    expect(appSection).toHaveTextContent('应用健康检查地址能否正常访问')
    expect(appSection.compareDocumentPosition(ifaceSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 分区不再是独立卡片：卡内不出现嵌套 .ant-card
    expect(panel.querySelectorAll('.ant-card')).toHaveLength(0)
    // 但 probe-panel 本身是张卡（SurfaceCard）
    expect(panel.className).toContain('ant-card')

    // 每卡四格总体数字：共 N · 正常 X · 异常 Y · 未知 Z（接口 6 条：4 正常 2 异常；应用 2 条全正常）
    expect(within(ifaceSection).getByText('探活目标')).toBeInTheDocument()
    expect(screen.getByTestId('probe-stat-interface_service-total')).toHaveTextContent('6')
    expect(screen.getByTestId('probe-stat-interface_service-normal')).toHaveTextContent('4')
    expect(screen.getByTestId('probe-stat-interface_service-abnormal')).toHaveTextContent('2')
    expect(screen.getByTestId('probe-stat-interface_service-unknown')).toHaveTextContent('0')
    expect(screen.getByTestId('probe-stat-application-total')).toHaveTextContent('2')
    expect(screen.getByTestId('probe-stat-application-normal')).toHaveTextContent('2')
    expect(screen.getByTestId('probe-stat-application-abnormal')).toHaveTextContent('0')

    // §2.7：不渲染任何完整明细表与分页器
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
    expect(panel.querySelector('.ant-pagination')).toBeNull()

    // 第六轮走查：**异常明细不在首页展示**（产品负责人裁定），首页只给计数；
    // 逐条明细走各分区深链到资源清单，按拨测类型预筛（resource_category 决定首屏 Tab）
    expect(screen.queryByTestId('probe-abnormal-list-interface_service')).not.toBeInTheDocument()
    expect(screen.queryByTestId('probe-abnormal-interface_service-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('probe-footnote')).not.toBeInTheDocument()
    expect(screen.getByTestId('probe-section-link-interface_service')).toBeInTheDocument()
    expect(
      within(screen.getByTestId('probe-section-link-interface_service')).getByRole('link', {
        name: '查看接口服务采集对象 →',
      }),
    ).toHaveAttribute('href', '/resources?resource_category=interface_service')
    expect(
      within(screen.getByTestId('probe-section-link-application')).getByRole('link', {
        name: '查看应用服务采集对象 →',
      }),
    ).toHaveAttribute('href', '/resources?resource_category=application')

    // 卡头深链（第六轮走查改版）：原「拨测任务管理 →」改为**异常明细入口**——
    // M09 监控目标状态（/targets）预筛「离线」，落页即只看异常节点
    expect(within(panel).getByRole('link', { name: '查看异常拨测目标 →' })).toHaveAttribute(
      'href',
      '/targets?health=down',
    )
  })

  it('keeps probe counts on the homepage without listing abnormal details', async () => {
    // 5 条 down：首页只给计数（异常 5）+ 正常率圆环，明细走资源清单深链（第六轮走查）
    const downs = Array.from({ length: 5 }, (_, i) => ({
      service_name: `异常服务-${i}`,
      resource_category: 'interface_service',
      url: `https://down-${i}.example.cn/health`,
      status: 'down',
      network_domain_name: '生产内网域',
      last_probe_at: isoAgo(i + 1),
    }))
    setupHomeMock({
      [DASHBOARD_PATH]: {
        status: 'success',
        data: { ...DASHBOARD_OK.data, probe_targets: downs },
      },
    })

    renderPage()

    await waitFor(() => {
      // 汇总行已移除，整体情况看正常率圆环：0/5 = 0%
      expect(screen.getByTestId('probe-health-rate-percent')).toHaveTextContent('0%')
    })
    expect(screen.getByTestId('probe-health-rate-value')).toHaveTextContent('正常 0 / 共 5')

    // 计数照常（异常 5），但**不列任何异常明细**——首页只报数，明细走分区深链
    expect(screen.getByTestId('probe-stat-interface_service-abnormal')).toHaveTextContent('5')
    expect(screen.queryByTestId('probe-abnormal-interface_service-0')).not.toBeInTheDocument()
    expect(screen.queryByTestId('probe-abnormal-more-interface_service')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('probe-section-link-interface_service')).getByRole('link', {
        name: '查看接口服务采集对象 →',
      }),
    ).toHaveAttribute('href', '/resources?resource_category=interface_service')
  })

  it('renders both probe cards with dashes for the empty category', async () => {
    // 空类别保留分区与空提示，统计值统一显示 '-'。
    setupHomeMock({
      [DASHBOARD_PATH]: {
        status: 'success',
        data: {
          ...DASHBOARD_OK.data,
          probe_targets: [
            { service_name: '支付平台', resource_category: 'interface_service', url: 'https://pay-api.example.cn/healthz', status: 'down', network_domain_id: 'mc-prod-intranet', network_domain_name: '生产内网域', last_probe_at: isoAgo(5) },
          ],
        },
      },
    })

    renderPage()

    const panel = screen.getByTestId('probe-panel')
    await waitFor(() => {
      // 汇总行已移除：1 条 down → 正常率 0%
      expect(screen.getByTestId('probe-health-rate-percent')).toHaveTextContent('0%')
    })
    expect(screen.getByTestId('probe-health-rate-value')).toHaveTextContent('正常 0 / 共 1')
    expect(within(panel).getByText('接口服务探活')).toBeInTheDocument()
    const appSection = screen.getByTestId('probe-section-application')
    expect(appSection).toHaveTextContent('应用服务探活')
    expect(screen.getByTestId('probe-stat-application-total')).toHaveTextContent('-')
    expect(screen.getByTestId('probe-stat-application-normal')).toHaveTextContent('-')
    expect(screen.getByTestId('probe-stat-application-abnormal')).toHaveTextContent('-')
    expect(screen.getByTestId('probe-stat-application-unknown')).toHaveTextContent('-')
    expect(appSection).toHaveTextContent('暂无应用服务探活目标')
    // 接口服务分区计数照常（1 条 down → 异常 1），但不列明细（第六轮走查）
    expect(screen.getByTestId('probe-stat-interface_service-abnormal')).toHaveTextContent('1')
    expect(screen.queryByTestId('probe-abnormal-interface_service-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('probe-section-link-application')).toBeInTheDocument()
  })

  it('counts backend probe_targets by status without rendering the detail rows', async () => {
    // 「真实款」数据：status 空串（无 probe_success 样本）计未知态、down 计异常；
    // 第六轮走查后首页只报数（不出现明细行），明细走资源清单深链。
    setupHomeMock({
      [DASHBOARD_PATH]: {
        status: 'success',
        data: {
          ...DASHBOARD_OK.data,
          probe_targets: [
            // 两条未知（status '' + 空 last_probe_at）
            { service_name: '网关服务', resource_category: 'interface_service', url: 'https://gw.example.cn/ping', status: '', network_domain_id: 'edge-1', network_domain_name: '边缘网域A', last_probe_at: undefined },
            // 明确 down → 计异常
            { service_name: '支付平台', resource_category: 'interface_service', url: 'https://pay-api.example.cn/healthz', status: 'down', network_domain_id: 'default', network_domain_name: '管理网域', last_probe_at: isoAgo(5) },
            // service_name 缺失不影响计数
            { service_name: '', resource_category: 'interface_service', url: 'https://www.example.cn/a', status: '', network_domain_id: 'edge-1', network_domain_name: '边缘网域A', last_probe_at: undefined },
          ],
        },
      },
    })

    renderPage()

    const panel = screen.getByTestId('probe-panel')
    // down 1 条被明确数出，未知不参与「正常 / 异常」计数
    await waitFor(() => {
      // 汇总行已移除：3 条目标（1 down + 2 未知）→ 正常率 0%
      expect(screen.getByTestId('probe-health-rate-percent')).toHaveTextContent('0%')
    })
    expect(screen.getByTestId('probe-health-rate-value')).toHaveTextContent('正常 0 / 共 3')

    // §2.7：明细表、分页器与明细行都已移除（首页只报数）
    expect(within(panel).queryByRole('table')).not.toBeInTheDocument()
    expect(panel.querySelector('.ant-pagination')).toBeNull()
    expect(screen.queryByTestId('probe-abnormal-interface_service-0')).not.toBeInTheDocument()

    // 未知态在统计条里如实计数：共 3 · 正常 0 · 异常 1 · 未知 2
    expect(screen.getByTestId('probe-stat-interface_service-total')).toHaveTextContent('3')
    expect(screen.getByTestId('probe-stat-interface_service-normal')).toHaveTextContent('0')
    expect(screen.getByTestId('probe-stat-interface_service-abnormal')).toHaveTextContent('1')
    expect(screen.getByTestId('probe-stat-interface_service-unknown')).toHaveTextContent('2')
    // 明细深链仍在（按接口服务类型预筛）
    expect(
      within(screen.getByTestId('probe-section-link-interface_service')).getByRole('link', {
        name: '查看接口服务采集对象 →',
      }),
    ).toHaveAttribute('href', '/resources?resource_category=interface_service')
  })

  it('renders placeholder instead of 0% for the coverage big number when there are no resources', async () => {
    setupHomeMock({ [DASHBOARD_PATH]: DASHBOARD_EMPTY })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 0 / 共 0')
    })

    // 无资源时已下发 / 资源总数按真实 0 值报出（0 是有效计量值，不等同取数失败），
    // 百分比无分母故显示 '-'，绝不渲染 0%（R1：归口到 04 区块圆环）
    expect(screen.getByTestId('overall-coverage-percent')).toHaveTextContent('-')
    expect(screen.getByTestId('overall-coverage-percent').textContent).not.toContain('0%')
    expect(screen.getByTestId('overall-coverage-bar')).toHaveAttribute('aria-valuenow', '0')
    // 03 矩阵无主机数据 → 不可用态，绝不渲染全 0 矩阵
    expect(screen.getByTestId('pam-unavailable')).toBeInTheDocument()
    // 六类行仍渲染（缺则补条目），但**没登记过该类对象时各计数列为 '-'**（第六轮走查：
    // 0 是「登记了但没配置采集」的有效值，与「压根没有这类对象」必须区分）
    expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
    expect(screen.getByTestId('l1-monitored-host')).toHaveTextContent('-')
    expect(screen.getByTestId('l1-total-host')).toHaveTextContent('-')
    expect(screen.getByTestId('l1-uncovered-host')).toHaveTextContent('-')
    expect(screen.getByTestId('l1-coverage-host')).toHaveTextContent('-')
    // 应用覆盖明细表已删除：其「去导入资源」动线由 03 矩阵脚注的补录引导承接（§2.4）
    expect(screen.queryByTestId('l2-app-table')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /去导入资源/ })).not.toBeInTheDocument()
  })

  it('keeps the four metrics and shows the current-alert empty text when there are no open alerts', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_EMPTY,
      [STATS_PATH]: STATS_OK,
    })

    renderPage()

    expect(await screen.findByTestId('latest-alert-empty')).toHaveTextContent('当前无告警')
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('2')
    expect(screen.getByTestId('alert-today-resolved-count')).toHaveTextContent('3')
    expect(screen.getByTestId('alert-legacy-open-count')).toHaveTextContent('1')
    expect(screen.getByTestId('alert-legacy-resolved-count')).toHaveTextContent('1')
    expect(screen.queryByRole('link', { name: '去配置通知规则 →' })).not.toBeInTheDocument()
    expect(screen.queryByText(/近 8 条/)).not.toBeInTheDocument()
  })

  it('renders the 查看全部 deep link on the alert card', async () => {
    setupHomeMock({ [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK })

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
    setupHomeMock({ [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const row = screen.getByTestId('latest-alert-0')
    // 行 1：级别 + 告警名 + 相对时间 + 状态（决策 73 两行制）
    const line1 = within(row).getByTestId('latest-alert-0-line1')
    expect(line1.style.display).toBe('flex')
    for (const text of ['严重', '主机 CPU 使用率过高', '5 分钟前', '告警中']) {
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
    expect(screen.getByTestId('latest-alert-2-line2')).toHaveTextContent('-')
  })

  it('states the 下发口径 next to the overall coverage figure instead of on per-card tips', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 96 / 共 128')
    })

    // 反馈 11：L0 指标卡与逐卡 ⓘ 口径提示整块删除，口径改由 04 区块脚注一次性说明
    expect(screen.queryByTestId('l0-section')).not.toBeInTheDocument()
    for (const key of METRIC_KEYS) {
      expect(screen.queryByTestId(`metric-${key}`)).not.toBeInTheDocument()
      expect(screen.queryByTestId(`metric-tip-${key}`)).not.toBeInTheDocument()
    }

    // 脚注必须用用户口径说明「配置进度 ≠ 已采到数据」，且不出现字段名
    const footnote = screen.getByTestId('overall-coverage-footnote')
    expect(footnote).toHaveTextContent('只反映配置进度，不代表数据已采到')
    expect(footnote.textContent).not.toContain('monitored_count')
  })

  it('keeps every alert figure inside the alert card', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK,
      [STATS_PATH]: STATS_OK,
    })

    renderPage()

    // 等告警卡渲染出当前告警，确保计数已到位
    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 反馈 11：告警数字不再拆散在首页 KPI 卡，只在独立整宽的告警卡内呈现
    const alertCard = screen.getByTestId('alert-status-card')
    expect(screen.queryByTestId('l0-section')).not.toBeInTheDocument()

    // 四格全部在告警卡内：今日 / 今日恢复 / 历史遗留 / 遗留今日恢复
    expect(within(alertCard).getByTestId('alert-today-count')).toHaveTextContent('2')
    expect(within(alertCard).getByTestId('alert-today-resolved-count')).toHaveTextContent('3')
    expect(within(alertCard).getByTestId('alert-legacy-open-count')).toHaveTextContent('1')
    expect(within(alertCard).getByTestId('alert-legacy-resolved-count')).toHaveTextContent('1')
    expect(alertCard).toHaveTextContent('告警中')

    // 02 云卡与 04 覆盖率区都不得出现任何告警数字（跨区块串味防线）
    const cloudPanel = screen.getByTestId('cloud-distribution-panel')
    expect(cloudPanel.textContent).not.toContain('告警')
    const coverage = screen.getByTestId('coverage-section')
    expect(coverage.textContent).not.toContain('告警')
  })

  it('renders placeholder instead of NaN when summary omits the by_cloud and by_platform_app fields', async () => {
    setupHomeMock({
      // 旧后端：响应缺少 monitored_count / by_cloud / by_platform_app
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

    // 新字段缺失时 02 / 03 走诚实降级态：02 空态、03 不可用态；
    // 绝不用静态样例云卡或全 0 矩阵伪造真实数据（决策 68-2）
    await waitFor(() => {
      expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 - / 共 -')
    })
    expect(screen.queryByTestId('cloud-cards')).not.toBeInTheDocument()
    expect(screen.getByTestId('cloud-distribution-panel')).toHaveTextContent('暂无主机数据')
    expect(screen.queryByTestId('cloud-card-PUB-TX')).not.toBeInTheDocument()
    expect(screen.getByTestId('pam-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('pam-table')).not.toBeInTheDocument()

    // 字段缺失不得渲染 NaN% / undefined；分组字段缺失时 L1 / L2 按空数据降级
    const page = screen.getByTestId('overall-coverage-value').closest('body') as HTMLElement
    expect(page.textContent).not.toContain('NaN')
    expect(page.textContent).not.toContain('undefined')
    expect(screen.getByTestId('overall-coverage-percent')).toHaveTextContent('-')
    expect(screen.getByTestId('overall-coverage-bar')).toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByTestId('l1-card-host')).toBeInTheDocument()
  })

  it('shows placeholder for the overall coverage figures when dashboard summary fails', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: { status: 'error', data: null, error: 'dashboard service unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('dashboard service unreachable')).toBeInTheDocument()
    })

    // 取数失败统一显示 '-'，不把失败静默成 0（告警卡数字独立取数，不随 summary 失败降级）
    expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 - / 共 -')
    expect(screen.getByTestId('overall-coverage-percent')).toHaveTextContent('-')
    expect(screen.getByTestId('pam-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('cloud-cards')).not.toBeInTheDocument()
    // 告警卡独立取数：两条链路均为空且成功时，四格仍为 0，右侧展示当前无告警空态
    await waitFor(() => {
      expect(screen.getByTestId('alert-status-card')).toBeInTheDocument()
    })
    expect(screen.getByTestId('alert-status-card')).toHaveTextContent('当前无告警')
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('0')
  })

  it('renders error message when the dashboard request throws', async () => {
    // 全链路 reject：summary 取数失败进 Alert（不静默成 0），告警三链路各自局部降级
    mockGet.mockRejectedValue(new Error('network failure'))

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText('network failure').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('takes the four metrics from the stats endpoint', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('alert-today-count')).toHaveTextContent('2')
    })
    expect(screen.getByTestId('alert-today-resolved-count')).toHaveTextContent('3')
    expect(screen.getByTestId('alert-legacy-open-count')).toHaveTextContent('1')
    expect(screen.getByTestId('alert-legacy-resolved-count')).toHaveTextContent('1')
  })

  it('renders four-cell alert stat strip and the latest alerts list', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK,
      [STATS_PATH]: STATS_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const alertCard = screen.getByTestId('alert-status-card')
    const strip = screen.getByTestId('alert-stat-strip')
    // §2.3 两栏化后：四格统计块在左列、当前告警列表在右列，两者都仍在告警卡内
    expect(screen.getByTestId('alert-stat-column').contains(strip)).toBe(true)
    expect(
      screen.getByTestId('alert-list-column').contains(screen.getByTestId('latest-alert-region')),
    ).toBe(true)
    expect(alertCard.contains(screen.getByTestId('alert-card-columns'))).toBe(true)
    // 四格全部来自 stats 接口：今日 2 / 今日恢复 3 / 历史遗留 1 / 遗留今日恢复 1
    expect(within(strip).getByTestId('alert-today-count')).toHaveTextContent('2')
    expect(within(strip).getByTestId('alert-today-resolved-count')).toHaveTextContent('3')
    expect(within(strip).getByTestId('alert-legacy-open-count')).toHaveTextContent('1')
    expect(within(strip).getByTestId('alert-legacy-resolved-count')).toHaveTextContent('1')
    // 四格只展示历史统计；未结状态仅保留在右侧当前告警行内
    expect(screen.queryByTestId('alert-active-count')).not.toBeInTheDocument()
    expect(screen.queryByTestId('alert-governed-count')).not.toBeInTheDocument()
    for (const label of ['今日告警', '今日告警今日恢复', '历史遗留告警', '历史遗留今日恢复']) {
      expect(within(strip).getByText(label)).toBeInTheDocument()
    }
    // 四格数字统一 20px/600（等宽数字）：第七轮走查字号阶梯——
    // 首页只留两个 24px 圆环作 hero，告警四格降到 primary 档，24px 的 700 在
    // 大屏上偏粗黑，数字统一 600 后与两个圆环并排时笔画粗细一致
    const todayCount = screen.getByTestId('alert-today-count')
    expect(todayCount.style.fontSize).toBe('20px')
    expect(todayCount.style.fontWeight).toBe('600')
    expect(todayCount.style.fontVariantNumeric).toBe('tabular-nums')

    // 当前告警：近 8 条上限，标题与取数共用常量；两行制不再需要表头
    expect(within(alertCard).getByText('当前告警')).toBeInTheDocument()
    // 标题不再带「近 8 条」（第六轮走查：上限是内部实现，标题带条数有歧义）
    expect(within(alertCard).queryByText(/近 8 条/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-header')).not.toBeInTheDocument()

    expect(within(screen.getByTestId('latest-alert-0')).getByText('主机 CPU 使用率过高')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-1')).getByText('磁盘使用率接近上限')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-2')).getByText('接口错误率升高')).toBeInTheDocument()
    // 首页右栏现在展示 event 表未结三态：静默中、抑制中也必须出现
    expect(within(screen.getByTestId('latest-alert-3')).getByText('内存使用率偏高')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-4')).getByText('节点失联')).toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-5')).not.toBeInTheDocument()
    expect(screen.queryByTestId('latest-alert-pager')).not.toBeInTheDocument()

    expect(within(screen.getByTestId('latest-alert-0')).getByText('5 分钟前')).toBeInTheDocument()
    // resource_name 缺失显示 '-'，不回落成采集地址
    expect(screen.getByTestId('latest-alert-2-line2')).toHaveTextContent(/^-/)

    expect(within(screen.getByTestId('latest-alert-0')).getByText('严重')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-0')).getByText('告警中')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-3')).getByText('静默中')).toBeInTheDocument()
    expect(within(screen.getByTestId('latest-alert-4')).getByText('抑制中')).toBeInTheDocument()
    expect(screen.queryByText(/待处理/)).not.toBeInTheDocument()

    // 卡内深链：告警中心入口已由标题右侧「查看全部 →」承担，底部不再重复（用户反馈 2026-09-14）；
    // 第六轮走查：「配置告警通知」深链按产品负责人要求移除——通知配置入口收敛到
    // 告警状态页与首页使用指引，告警卡不再背配置动作
    expect(within(alertCard).queryByRole('link', { name: '查看告警中心 →' })).not.toBeInTheDocument()
    expect(within(alertCard).queryByRole('link', { name: '配置告警通知' })).not.toBeInTheDocument()
  })

  it('renders all current alerts inside a scrollable list without pagination', async () => {
    // 12 条当前告警：全部渲染到卡内滚动区，不再按每页 5 条分页
    const list = Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      alert_name: `批量告警-${i}`,
      status: 'firing',
      severity: 'warning',
      summary: '',
      starts_at: isoAgo(i + 1),
      updated_at: isoAgo(i + 1),
      resource_name: `host-${i}`,
      instance_address: `10.0.0.${i}:9100`,
    }))
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: {
        status: 'success',
        data: { list, total: 12 },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId(/^latest-alert-\d+$/)).toHaveLength(12)
    expect(screen.getByTestId('latest-alert-11')).toBeInTheDocument()
    // 无分页器；列表在固定最大高度的滚动容器内
    expect(screen.queryByTestId('latest-alert-pager')).not.toBeInTheDocument()
    const scroll = screen.getByTestId('latest-alert-scroll')
    expect(scroll.style.overflowY).toBe('auto')
    expect(scroll.style.maxHeight).toBe('360px')
  })

  it('requests each alert endpoint exactly once for counts and the latest list', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK,
      [STATS_PATH]: STATS_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 两条只读链路各只请求一次（四格取 stats，当前告警走不分页接口，无重复取数）
    const paths = mockGet.mock.calls.map((call) => call[0] as string)
    expect(paths.filter((path) => path === CURRENT_ALERTS_PATH)).toHaveLength(1)
    expect(paths.filter((path) => path === STATS_PATH)).toHaveLength(1)
    // 当前告警不分页：调用不携带 status/page/page_size 参数
    const currentCall = mockGet.mock.calls.find(([path]) => path === CURRENT_ALERTS_PATH)
    expect((currentCall?.[1] as { params?: unknown }).params).toBeUndefined()
    // 列表首条来自同一份响应
    expect(screen.getByTestId('latest-alert-0')).toHaveTextContent('主机 CPU 使用率过高')
  })

  it('renders firing, silenced and inhibited open alerts and never shows the retired 待处理 state', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: {
        status: 'success',
        data: {
          list: [
            {
              id: 1,
              alert_name: '队列积压',
              status: 'firing',
              severity: 'warning',
              summary: '',
              starts_at: isoAgo(1),
              updated_at: isoAgo(1),
            },
            {
              id: 2,
              alert_name: '静默告警',
              status: 'silenced',
              severity: 'warning',
              summary: '',
              starts_at: isoAgo(2),
              updated_at: isoAgo(2),
            },
            {
              id: 3,
              alert_name: '抑制告警',
              status: 'inhibited',
              severity: 'warning',
              summary: '',
              starts_at: isoAgo(3),
              updated_at: isoAgo(3),
            },
          ],
          total: 3,
        },
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })
    for (const name of ['队列积压', '静默告警', '抑制告警']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    expect(screen.getByText('告警中')).toBeInTheDocument()
    expect(screen.getByText('静默中')).toBeInTheDocument()
    expect(screen.getByText('抑制中')).toBeInTheDocument()
    expect(screen.queryByText(/待处理/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('alert-unprocessed-note')).not.toBeInTheDocument()
  })

  it('always renders the four metrics when all alert sources are empty', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_EMPTY,
    })

    renderPage()

    expect(await screen.findByTestId('latest-alert-empty')).toHaveTextContent('当前无告警')
    expect(screen.getByTestId('alert-stat-strip')).toBeInTheDocument()
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('0')
    expect(screen.getByTestId('alert-today-resolved-count')).toHaveTextContent('0')
    expect(screen.getByTestId('alert-legacy-open-count')).toHaveTextContent('0')
    expect(screen.getByTestId('alert-legacy-resolved-count')).toHaveTextContent('0')
    expect(screen.queryByRole('link', { name: '去配置通知规则 →' })).not.toBeInTheDocument()
  })

  it('renders warning but keeps current-alert data when the stats source fails', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK,
      [STATS_PATH]: { status: 'error', data: null, error: 'stats unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('部分告警数据加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('stats unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    // 统计链路失败，但 AM 已成功的数据仍应展示（局部降级，不整卡报错）
    expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('-')
  })

  it('shows placeholder instead of 0 when the current-alerts source fails', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: Promise.reject(new Error('alerts down')),
      [STATS_PATH]: STATS_OK,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('部分告警数据加载失败')).toBeInTheDocument()
    })

    // 当前告警链路失败 → 列表显示不可用提示，不把失败静默成 0
    expect(screen.getByTestId('latest-alert-unavailable')).toBeInTheDocument()
    // 统计侧成功 → 四格仍展示真实数字（局部降级不整片归零）
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('2')
    expect(screen.getByTestId('alert-today-resolved-count')).toHaveTextContent('3')
  })

  it('shows placeholder instead of 0 for the four metrics when the stats source fails', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK,
      [STATS_PATH]: Promise.reject(new Error('stats down')),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    // 统计取数失败 → 四格 '-'（不显示 0），当前告警仍展示
    expect(screen.getByTestId('alert-today-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-today-resolved-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-legacy-open-count')).toHaveTextContent('-')
    expect(screen.getByTestId('alert-legacy-resolved-count')).toHaveTextContent('-')
    expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    // 单条统计链路失败走部分降级，不并入「告警状态加载失败」整卡错误态
    expect(screen.getByText('部分告警数据加载失败')).toBeInTheDocument()
    expect(screen.queryByText('告警状态加载失败')).not.toBeInTheDocument()
  })

  it('renders placeholder when the stats envelope omits required fields', async () => {
    setupHomeMock({
      [STATS_PATH]: { status: 'success', data: { today_total: 2 } },
    })

    renderPage()

    // 字段缺失不得渲染 0，与取数失败同等降级为 '-'
    await waitFor(() => {
      expect(screen.getByTestId('alert-today-count')).toHaveTextContent('-')
    })
    expect(screen.getByTestId('alert-today-resolved-count')).toHaveTextContent('-')
    expect(screen.queryByText('去配置通知规则 →')).not.toBeInTheDocument()
  })

  it('renders error state when alert APIs return business error envelopes', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: { status: 'error', data: null, error: 'alerts unreachable' },
      [STATS_PATH]: { status: 'error', data: null, error: 'stats unreachable' },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('告警状态加载失败')).toBeInTheDocument()
    })
    // 业务错误信封必须显式呈现，不得静默吞成 0 + 空态引导
    expect(screen.getByText(/alerts unreachable/)).toBeInTheDocument()
    expect(screen.getByText(/stats unreachable/)).toBeInTheDocument()
    expect(screen.queryByText('当前无告警')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('renders alert card error state with retry button', async () => {
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: Promise.reject(new Error('alerts down')),
      [STATS_PATH]: Promise.reject(new Error('stats down')),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('告警状态加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText(/alerts down/)).toBeInTheDocument()
    expect(screen.getByText(/stats down/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('renders the alert card and the onboarding guide as two independent full-width blocks', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-steps-card')).toBeInTheDocument()
    })

    // 反馈 11 §11.2 ⑦⑧：告警状态从原06 段（与使用指引同排）上移到 04 正下方，
    // 两块各自独立整宽，不再有 home-l45-row 这根 flex 行容器。
    expect(screen.queryByTestId('home-l45-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quick-access-card')).not.toBeInTheDocument()

    const alertSection = screen.getByTestId('home-alert-section')
    const guideSection = screen.getByTestId('home-onboarding-section')
    // 每块自己包住自己的卡，块自身不落在栅格列上（= 整宽，不是半宽并排）
    expect(alertSection.contains(screen.getByTestId('alert-status-card'))).toBe(true)
    expect(guideSection.contains(screen.getByTestId('onboarding-steps-card'))).toBe(true)
    expect(alertSection.closest('.ant-col')).toBeNull()
    expect(guideSection.closest('.ant-col')).toBeNull()

    // 告警在指引之前（顺序与裁定一致）
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(following(alertSection, guideSection)).toBe(true)
  })

  it('renders the cloud host count as a compact row (16px/600) and the L1 figures in the coverage table', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('cloud-card-PUB-TX')).toBeInTheDocument()
    })

    // 第五轮：云分布是紧凑统计行——台数 + 「台主机」量词（旧 32px/800 KPI 卡已下线，
    // 2 朵云时左卡不再被撑高）；无图标容器、无已下发 / 纳管率。
    // 第七轮走查：18px/700 → **16px/600**——「行级计数」在首页一律 16/600（云台数、
    // 采集四态、拨测四格同尺寸），横向扫读时三张卡的数字等高
    const card = screen.getByTestId('cloud-card-PUB-TX')
    const value = screen.getByTestId('cloud-host-count-PUB-TX')
    expect(value).toHaveTextContent('30')
    expect(value.style.fontSize).toBe('16px')
    expect(value.style.fontWeight).toBe('600')
    expect(value.style.fontVariantNumeric).toBe('tabular-nums')
    expect(card).toHaveTextContent('台主机')

    // 04 六类表格：已配置采集 36 / 总数 42 / 纳管率 86% / 未配置采集 6（与旧卡同口径，表格化呈现）
    expect(screen.getByTestId('l1-monitored-host')).toHaveTextContent('36')
    // 单位已去除（第六轮走查）：表头已说明是「采集」，列内只留数字
    expect(screen.getByTestId('l1-monitored-host').textContent).not.toContain('台')
    expect(screen.getByTestId('l1-total-host')).toHaveTextContent('42')
    expect(screen.getByTestId('l1-coverage-host')).toHaveTextContent('86%')
    expect(screen.getByTestId('l1-uncovered-host')).toHaveTextContent('6')
  })

  it('renders the overall coverage donut and the 下发 figures from dashboard summary', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('监控对象纳管完成率')).toBeInTheDocument()
    })

    // 2026-10-17 走查：区块标题由「纳管覆盖率」通俗化为「监控对象纳管完成率」
    // （「纳管覆盖率」是平台内部说法，领导读不懂；精确口径由 Tooltip + 脚注承载）；
    // 全局态势感知不再呈现给领导
    expect(screen.getByText('监控对象纳管完成率')).toBeInTheDocument()
    expect(screen.queryByText('全局态势')).not.toBeInTheDocument()

    // 第五轮：8px 进度条 → 百分比圆环。aria-valuenow 75（96 ÷ 128）+ 品牌色弧 + 圆心 75%
    const donut = screen.getByTestId('overall-coverage-bar')
    expect(donut).toHaveAttribute('aria-valuenow', '75')
    expect(donut).toHaveAttribute('aria-label', '监控对象纳管完成率 75%')
    expect(screen.getByTestId('overall-coverage-percent')).toHaveTextContent('75%')

    // 副行：已下发 96 / 共 128（= 六类台账合计），未下发数由六类表格「未下发」列承接
    expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 96 / 共 128')
    expect(screen.getByTestId('l1-uncovered-host')).toHaveTextContent('6')
  })

  it('renders the 04 coverage donut at 24px/500 with the arc and the percent in the brand color', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('overall-coverage-percent')).toHaveTextContent('75%')
    })

    // 第五轮圆环：圆心文字 24px，字重第七轮走查由 500 收到 600（数字统一 600，
    // 与拨测正常率圆环同几何同心字号），色值与进度弧同源（token.colorPrimary，
    // 不写死色值，避免换肤 / 主题变更即失败）
    const percent = screen.getByTestId('overall-coverage-percent')
    expect(percent.getAttribute('font-size')).toBe('24')
    expect(percent.getAttribute('font-weight')).toBe('600')
    const arcs = screen.getByTestId('overall-coverage-bar').querySelectorAll('circle')
    expect(arcs).toHaveLength(2)
    expect(percent.getAttribute('fill')).toBe(arcs[1].getAttribute('stroke'))
    expect(screen.getByText('整体纳管完成率')).toBeInTheDocument()
    // 第六轮走查改词：「已下发」表述不清（产品负责人：「是采集策略已下发吗」）→「已配置」
    expect(screen.getByTestId('overall-coverage-value')).toHaveTextContent('已配置 96 / 共 128')
    // 圆环在六类表格之前（左整体 → 右明细，同卡共同体）；脚注通俗化：明示计算公式 + 与「采集健康」的分工。
    // 第六轮走查定稿：脚注在**卡底左对齐**（曾放圆环块内——140px 窄列放长句太挤），
    // 位于 coverage-body 之后
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(following(screen.getByTestId('overall-coverage-bar'), screen.getByTestId('l1-card-host'))).toBe(true)
    expect(following(screen.getByTestId('coverage-body'), screen.getByTestId('overall-coverage-footnote'))).toBe(true)
    expect(screen.getByTestId('overall-coverage-footnote')).toHaveTextContent(
      '按「已配置采集任务的资源数 ÷ 资源总数」计算，只反映配置进度，不代表数据已采到；实际采集情况见下方「采集健康」。',
    )
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

    // 2026-10-17 走查：使用指引为**一行横排**六步 Steps（窄屏卡内横向滚动）
    const onboarding = screen.getByTestId('onboarding-steps-card')
    expect(onboarding.querySelector('.ant-steps')).not.toBeNull()
    expect(onboarding.querySelector('.ant-steps-horizontal')).not.toBeNull()

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

  it('keeps the side-by-side alert card layout with an internal scroll area', async () => {
    setupHomeMock({ [CURRENT_ALERTS_PATH]: CURRENT_ALERTS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })

    const alertCard = screen.getByTestId('alert-status-card')
    // 并排容器是 flex 分区而非栅格列：告警卡的直接宿主是 home-alert-section，
    // 其上再没有 .ant-col（不落 24 栅格）
    expect(alertCard.closest('.ant-col')).toBeNull()
    expect(screen.queryByText('最近下发记录')).not.toBeInTheDocument()

    // 告警卡：卡体为纵向 flex；右栏不再有页脚，左栏四格分摊卡高
    const alertBody = alertCard.querySelector('.ant-card-body') as HTMLElement
    expect(alertBody.style.display).toBe('flex')
    expect(alertBody.style.flexDirection).toBe('column')
    expect(screen.queryByTestId('alert-card-footer')).not.toBeInTheDocument()
    expect(screen.getByTestId('alert-stat-column')).toBeInTheDocument()
    // 列表改为卡内滚动容器
    expect(screen.getByTestId('latest-alert-scroll')).toBeInTheDocument()
  })

  it('renders all fetched alerts in an internal scroll area independent of the viewport', async () => {
    // 8 条当前告警：全部渲染，不分页；滚动由容器承担，不随视口高度变化
    const list = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      alert_name: `批量告警-${i}`,
      status: 'firing',
      severity: 'warning',
      summary: '',
      starts_at: isoAgo(i + 1),
      updated_at: isoAgo(i + 1),
      resource_name: `host-${i}`,
      instance_address: `10.0.0.${i}:9100`,
    }))
    setupHomeMock({
      [CURRENT_ALERTS_PATH]: { status: 'success', data: { list, total: 8 } },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('latest-alert-0')).toBeInTheDocument()
    })
    expect(screen.getAllByTestId(/^latest-alert-\d+$/)).toHaveLength(8)
    expect(screen.queryByTestId('latest-alert-pager')).not.toBeInTheDocument()

    const scroll = screen.getByTestId('latest-alert-scroll')
    expect(scroll.style.overflowY).toBe('auto')
    expect(scroll.style.maxHeight).toBe('360px')
    expect(screen.getByTestId('latest-alert-region').style.display).toBe('flex')
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

  it('adapts to the mobile viewport: cloud compact rows, L1 table rows, matrix keeps its table, stat strip 2×2', async () => {
    stubNarrowViewport()
    // 历史统计有数据 → 告警卡不落入空态，四格统计条会真实渲染（用于断言 2×2）
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 反馈 11 §11.6：L0 已删除，无「两卡一行」分支
    expect(screen.queryByTestId('l0-section')).not.toBeInTheDocument()

    // 02 云卡：第五轮改为「一行一朵云」紧凑统计行（无栅格列），窄宽屏同一版式
    const cloudCards = screen.getByTestId('cloud-cards')
    expect(cloudCards.querySelectorAll('.ant-col')).toHaveLength(0)
    expect(screen.getAllByTestId(/^cloud-card-/)).toHaveLength(2)

    // L1：第五轮改为表格（一行一类型），窄屏六类六行 + 横向滚动，不再是单卡一行栅格
    const l1Grid = screen.getByTestId('l1-grid')
    expect(l1Grid.querySelectorAll('.ant-col')).toHaveLength(0)
    expect(within(l1Grid).getAllByTestId(/^l1-card-/)).toHaveLength(6)
    // 窄屏徽标列隐藏，列宽收窄（列宽走 prop 而非断点类，jsdom 不断言像素）
    expect(within(l1Grid).getByTestId('l1-table')).toBeInTheDocument()

    // 04 覆盖率：窄屏圆环与表格上下堆叠（coverage-body 纵排）
    const coverageBody = screen.getByTestId('coverage-body')
    expect(coverageBody.style.flexDirection).toBe('column')
    // **第七轮走查手机端修复的回归锚点**：纵排时必须 stretch。
    // 走查前恒为 `center`——纵轴布局里 center = 横向居中 + 按内容收缩，表格容器被压到
    // flex-basis 260px 居中，卡内剩余宽度只能靠表内横滚消化，末列「未配置」被裁（截图问题）。
    expect(coverageBody.style.alignItems).toBe('stretch')

    // 窄屏表格基础宽必须能在 360px 竖屏机型里放下（内容区 360 − 24 − 24 = 312）：
    // 列宽合计 300 是 ResourceTypeGrid 的窄屏常量，超了就会重新出现横向滚动 + 末列被切
    const l1NarrowTable = within(l1Grid)
      .getByTestId('l1-table')
      .querySelector('.ant-table-content table') as HTMLElement
    expect(parseFloat(l1NarrowTable.style.width)).toBeLessThanOrEqual(300)

    // 资源管理行（第六轮）：02 + 03 两块仍在同一 flex-wrap 容器内，
    // 窄屏各自整宽堆叠（折行由容器宽度决定，jsdom 不断言像素）
    const resourceRow = screen.getByTestId('home-resource-row')
    expect(resourceRow).toContainElement(screen.getByTestId('cloud-distribution-panel'))
    expect(resourceRow).toContainElement(screen.getByTestId('platform-app-matrix-panel'))

    // 03 矩阵：窄屏**保留二维表格 + 横向滚动 + 固定首列**，不降级为卡片列表
    expect(screen.getByTestId('pam-table')).toBeInTheDocument()
    // 矩阵行不下钻；面板内唯一链接为脚注的台账补录引导（§2.4 遗留补偿）
    const matrixLinks = within(screen.getByTestId('platform-app-matrix-panel')).queryAllByRole('link')
    expect(matrixLinks).toHaveLength(1)
    expect(matrixLinks[0]).toHaveAttribute('href', '/resources?import=1')
    expect(within(screen.getByTestId('platform-app-matrix-panel')).queryAllByRole('table')).toHaveLength(1)

    // 两个运行态行（第六轮）：「04 + 告警」行 + 「采集健康 + 拨测」行，
    // 窄容器下 flex-wrap 折行各自整宽堆叠（不再有告警↔指引同排的 home-l45-row）
    expect(screen.queryByTestId('home-l45-row')).not.toBeInTheDocument()
    expect(screen.getByTestId('home-coverage-alert-row')).toContainElement(
      screen.getByTestId('home-alert-section'),
    )
    expect(screen.getByTestId('home-health-probe-row')).toContainElement(
      screen.getByTestId('home-collection-health-section'),
    )
    expect(screen.getByTestId('home-health-probe-row')).toContainElement(
      screen.getByTestId('home-probe-section'),
    )
    const narrowFollowing = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      narrowFollowing(
        screen.getByTestId('home-collection-health-section'),
        screen.getByTestId('home-probe-section'),
      ),
    ).toBe(true)
    expect(
      narrowFollowing(
        screen.getByTestId('home-probe-section'),
        screen.getByTestId('home-onboarding-section'),
      ),
    ).toBe(true)

    // §2.3：告警卡卡体两栏在窄屏**上下堆叠**，左栏统计条维持 2×2（每格半宽 + 换行）
    expect(screen.getByTestId('alert-card-columns').style.flexDirection).toBe('column')
    expect(screen.getByTestId('alert-stat-strip').style.flexWrap).toBe('wrap')
    expect((screen.getByTestId('alert-today-count').parentElement as HTMLElement).style.flex).toBe(
      '0 0 50%',
    )
  })

  it('keeps the desktop resource row (02+03), the coverage+alert split and the health-probe row on wide viewports', async () => {
    // 默认 matchMedia 全部 matches:false（setupAntdTest）→ 宽屏分支
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 02 云卡 / L1：均不再走 24 栅格 Col——云为紧凑统计行、L1 为表格，
    // 宽窄屏同一 DOM 结构（响应式差异只在 L1 列宽 prop 与 04 圆环纵排）
    expect(screen.getByTestId('cloud-cards').querySelectorAll('.ant-col')).toHaveLength(0)
    const l1Grid = screen.getByTestId('l1-grid')
    expect(l1Grid.querySelectorAll('.ant-col')).toHaveLength(0)
    expect(within(l1Grid).getAllByTestId(/^l1-card-/)).toHaveLength(6)

    // 资源管理行（第六轮）：02 收窄为 0 1 260px 固定窄列（原 1 1 460px「过长」），
    // 03 分享剩余宽度；两者基础宽之和 ≈696px，1440 视口一行放得下
    const resourceRow = screen.getByTestId('home-resource-row')
    expect(resourceRow.style.flexWrap).toBe('wrap')
    const cloudWrapper = screen.getByTestId('cloud-distribution-panel').parentElement as HTMLElement
    const matrixWrapper = screen.getByTestId('platform-app-matrix-panel').parentElement as HTMLElement
    expect(cloudWrapper.style.flex).toBe('0 1 260px')
    expect(matrixWrapper.style.flex).toBe('1 1 420px')

    // 「04 + 告警」行：对分（flex 1:1，各 ≈568px @1440）；
    // 「采集 + 拨测」行：grow 填满整行（采集 1 : 拨测 2）
    expect(screen.queryByTestId('home-l45-row')).not.toBeInTheDocument()
    const alertSection = screen.getByTestId('home-alert-section')
    const healthSection = screen.getByTestId('home-collection-health-section')
    const probeSection = screen.getByTestId('home-probe-section')
    expect(screen.getByTestId('coverage-section').style.flex).toBe('1 1 460px')
    expect(alertSection.style.flex).toBe('1 1 460px')
    expect(healthSection.style.flex).toBe('1 1 360px')
    expect(probeSection.style.flex).toBe('2 1 560px')
    expect(screen.getByTestId('home-coverage-alert-row')).toContainElement(
      screen.getByTestId('coverage-section'),
    )
    expect(screen.getByTestId('home-coverage-alert-row')).toContainElement(alertSection)
    expect(screen.getByTestId('home-health-probe-row')).toContainElement(healthSection)
    expect(screen.getByTestId('home-health-probe-row')).toContainElement(probeSection)
    expect(alertSection.contains(screen.getByTestId('alert-status-card'))).toBe(true)
    expect(healthSection.contains(screen.getByTestId('collection-health-panel'))).toBe(true)
    expect(probeSection.contains(screen.getByTestId('probe-panel'))).toBe(true)
    expect(alertSection.closest('.ant-col')).toBeNull()
    expect(healthSection.closest('.ant-col')).toBeNull()
    expect(probeSection.closest('.ant-col')).toBeNull()

    // §2.3：宽屏卡体两栏——左统计块（四格**纵排**，flexDirection column）
    // ≠ 窄屏的一行四格横向变体（后者保留给 2×2 断点）。第六轮走查：统计块 280 → 220px
    // （对分半幅卡里原列宽过宽，产品负责人走查要求收窄）
    expect(screen.getByTestId('alert-card-columns').style.flexDirection).toBe('row')
    expect(screen.getByTestId('alert-stat-strip').style.flexDirection).toBe('column')
    expect(screen.getByTestId('alert-stat-column').style.flex).toBe('0 0 220px')
  })

  it('splits the coverage card and the alert card evenly, and stretches the health-probe row to full width', async () => {
    setupHomeMock({ [STATS_PATH]: STATS_OK })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 「04 + 告警」行：对分——两节 flex 值逐字相同（1 1 460px），1440 视口下各 ≈568px
    const coverageAlertRow = screen.getByTestId('home-coverage-alert-row')
    expect(coverageAlertRow.style.flexWrap).toBe('wrap')
    expect(coverageAlertRow.style.gap).toBe('16px')
    expect(screen.getByTestId('coverage-section').style.flex).toBe('1 1 460px')
    expect(screen.getByTestId('home-alert-section').style.flex).toBe('1 1 460px')

    // 「采集 + 拨测」行：两者均带 flex-grow，grow 拉伸填满整行（不留右侧空白）
    const healthProbeRow = screen.getByTestId('home-health-probe-row')
    expect(healthProbeRow.style.flexWrap).toBe('wrap')
    const healthFlex = screen.getByTestId('home-collection-health-section').style.flex
    const probeFlex = screen.getByTestId('home-probe-section').style.flex
    expect(healthFlex).toBe('1 1 360px')
    expect(probeFlex).toBe('2 1 560px')
    expect(healthProbeRow).toContainElement(screen.getByTestId('collection-health-panel'))
    expect(healthProbeRow).toContainElement(screen.getByTestId('probe-panel'))
    const following = (a: HTMLElement, b: HTMLElement) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(
      following(screen.getByTestId('home-collection-health-section'), screen.getByTestId('home-probe-section')),
    ).toBe(true)

    // 两行仍位于使用指引之前
    expect(following(coverageAlertRow, screen.getByTestId('home-onboarding-section'))).toBe(true)
    expect(following(healthProbeRow, screen.getByTestId('home-onboarding-section'))).toBe(true)
  })

  it('keeps the matrix footnote to a single merged line with the full scope in the title tooltip', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    // 第五轮缩减 + 第六轮合并为一行：完整口径（按主机台数统计、行=列=总数合计关系）
    // 在标题 Tooltip；可见版面只有一行——速记与补录引导合并同一行（不再分两行占高度）
    const footnote = screen.getByTestId('pam-footnote')
    expect(footnote).toHaveTextContent(
      '「其他」= 主机较少的平台合并；「未指定」= 还没填归属。归属未填的主机，可到 资源清单 补填或重新导入。',
    )
    expect(footnote.textContent ?? '').not.toContain('横竖合计')
    // 补录引导链接仍在同一行内（面板内唯一链接）
    expect(
      within(screen.getByTestId('platform-app-matrix-panel')).getByTestId(
        'pam-footnote-supplement-link',
      ),
    ).toHaveAttribute('href', '/resources?import=1')
  })

  it('hides the whole resource-management group (02+03) from the header toggle without leaving panel titles', async () => {
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('cloud-card-PUB-TX')).toBeInTheDocument()
    })

    // 默认显示：资源管理行在，页头开关文案为「隐藏资源分布」
    expect(screen.getByTestId('home-resource-row')).toBeInTheDocument()
    expect(screen.getByTestId('resource-panels-toggle')).toHaveTextContent('隐藏资源分布')

    // 第六轮走查：整组隐藏——home-resource-row 整体不渲染，**面板标题也不露出**
    // （藏得干净；恢复入口是页头行开关，不随面板一起消失）
    fireEvent.click(screen.getByTestId('resource-panels-toggle'))
    expect(screen.queryByTestId('home-resource-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('cloud-distribution-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('platform-app-matrix-panel')).not.toBeInTheDocument()
    expect(screen.queryByText('不同云的主机数量')).not.toBeInTheDocument()
    expect(screen.queryByText('平台与应用的主机分布')).not.toBeInTheDocument()
    // 偏好即写 localStorage（跨会话保留）
    expect(window.localStorage.getItem('metriccenter.home.resource-panels.collapsed')).toBe('1')

    // 运行态两行与使用指引不受影响
    expect(screen.getByTestId('home-coverage-alert-row')).toBeInTheDocument()
    expect(screen.getByTestId('home-health-probe-row')).toBeInTheDocument()
    expect(screen.getByTestId('home-onboarding-section')).toBeInTheDocument()

    // 再点一次恢复
    fireEvent.click(screen.getByTestId('resource-panels-toggle'))
    expect(screen.getByTestId('home-resource-row')).toBeInTheDocument()
    expect(screen.getByTestId('cloud-distribution-panel')).toBeInTheDocument()
    expect(window.localStorage.getItem('metriccenter.home.resource-panels.collapsed')).toBe('0')
  })

  it('starts with the resource-management group hidden when the persisted preference says so', async () => {
    // 模拟「上次隐藏了」的会话：初值读 localStorage，不渲染资源行，开关文案为「显示资源分布」
    window.localStorage.setItem('metriccenter.home.resource-panels.collapsed', '1')
    setupHomeMock()

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(PAGE_INTRO)).toBeInTheDocument()
    })

    expect(screen.queryByTestId('home-resource-row')).not.toBeInTheDocument()
    expect(screen.getByTestId('resource-panels-toggle')).toHaveTextContent('显示资源分布')
    // 其余区块照常渲染
    expect(screen.getByTestId('coverage-card')).toBeInTheDocument()
    expect(screen.getByTestId('alert-status-card')).toBeInTheDocument()
    expect(screen.getByTestId('probe-panel')).toBeInTheDocument()
  })
})
