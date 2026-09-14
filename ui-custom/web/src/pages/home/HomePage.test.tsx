import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
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

const STATUS_PATH = '/api/v1/status'
const DASHBOARD_PATH = '/api/v2/platform/dashboard/summary'
const PROM_ALERTS_PATH = '/api/v1/alerts'
const AM_ALERTS_PATH = '/api/v2/platform/alertmanager/alerts'

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
  data: { resource_count: 0, pending_draft_count: 0, domain_count: 0, recent_deployments: [] },
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

const AM_ALERTS_OK = {
  status: 'success',
  data: {
    items: [
      { notify_status: 'active', labels: {}, annotations: {}, starts_at: '2026-09-14T00:00:00Z' },
      { notify_status: 'active', labels: {}, annotations: {}, starts_at: '2026-09-14T00:00:00Z' },
      { notify_status: 'silenced', labels: {}, annotations: {}, starts_at: '2026-09-14T00:00:00Z' },
      { notify_status: 'inhibited', labels: {}, annotations: {}, starts_at: '2026-09-14T00:00:00Z' },
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

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('版本 v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText('模式 standalone')).toBeInTheDocument()

    // Dashboard 统计（用 within 限定在统计卡内，避免与步骤条图标数字冲突）
    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
    })
    const dashboardCard = screen.getByTestId('dashboard-card')
    expect(within(dashboardCard).getByText('10')).toBeInTheDocument()
    expect(within(dashboardCard).getByText('3')).toBeInTheDocument()
    expect(within(dashboardCard).getByText('2')).toBeInTheDocument()

    // 最近下发记录
    expect(screen.getByText('CHG-001')).toBeInTheDocument()
    expect(screen.getByText('政务网A区')).toBeInTheDocument()
  })

  it('renders friendly empty state when there are no recent deployments', async () => {
    setupHomeMock({ [DASHBOARD_PATH]: DASHBOARD_EMPTY })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('暂无下发记录')).toBeInTheDocument()
    })
  })

  it('renders error message when status API returns error status', async () => {
    setupHomeMock({
      [STATUS_PATH]: { status: 'error', data: null, error: 'status service unreachable' },
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('状态加载失败：status service unreachable')).toBeInTheDocument()
    })
  })

  it('renders error message when request throws', async () => {
    mockGet.mockRejectedValue(new Error('network failure'))

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getAllByText('network failure').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('renders error message when dashboard API returns error status', async () => {
    setupHomeMock({
      [DASHBOARD_PATH]: { status: 'error', data: null, error: 'dashboard service unreachable' },
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('dashboard service unreachable')).toBeInTheDocument()
    })
  })

  it('renders alert status counts from alertStatusApi', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_OK,
      [AM_ALERTS_PATH]: AM_ALERTS_OK,
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('通知中')).toBeInTheDocument()
    })

    // 主数字：AM notify_status === 'active' 计数 = 2
    const alertCard = screen.getByTestId('alert-status-card')
    expect(within(alertCard).getByText('2')).toBeInTheDocument()
    // 次要行：已静默 / 已抑制 = 1 / 1
    expect(within(alertCard).getByText('1 / 1')).toBeInTheDocument()
    // Prom 触发 / 待处理 = 2 / 1
    expect(within(alertCard).getByText('2 / 1')).toBeInTheDocument()
  })

  it('renders empty alert guidance linking to /alert-config when both alert sources are empty', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: PROM_ALERTS_EMPTY,
      [AM_ALERTS_PATH]: AM_ALERTS_EMPTY,
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('尚未挂载通知配置，去配置 →')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: '尚未挂载通知配置，去配置 →' })).toHaveAttribute(
      'href',
      '/alert-config',
    )
  })

  it('renders alert card error state with retry button', async () => {
    setupHomeMock({
      [PROM_ALERTS_PATH]: Promise.reject(new Error('alerts unreachable')),
      [AM_ALERTS_PATH]: AM_ALERTS_EMPTY,
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('告警状态加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('alerts unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('renders 5 quick access cards with correct links', async () => {
    setupHomeMock()

    render(<HomePage />)

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

  it('renders onboarding steps with step 5 linking to /query', async () => {
    setupHomeMock()

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('使用指引')).toBeInTheDocument()
    })

    const onboarding = screen.getByTestId('onboarding-steps-card')
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
    expect(within(onboarding).getByRole('link', { name: '查指标' })).toHaveAttribute('href', '/query')
  })

  it('does not render visualization screen entry', async () => {
    setupHomeMock()

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('Dashboard 概览')).toBeInTheDocument()
    })

    expect(screen.queryByText('可视化大屏')).not.toBeInTheDocument()
    expect(screen.queryByText('进入可视化大屏')).not.toBeInTheDocument()
  })
})
