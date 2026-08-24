import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
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

function setupMock(byPath: Record<string, unknown>) {
  mockGet.mockImplementation((path: string) => {
    if (path in byPath) {
      return Promise.resolve(byPath[path])
    }
    return Promise.reject(new Error(`unmocked path: ${path}`))
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

describe('HomePage', () => {
  setupAntdTest()

  beforeEach(() => {
    mockGet.mockReset()
  })

  it('renders system status and dashboard overview from API response', async () => {
    setupMock({ [STATUS_PATH]: STATUS_OK, [DASHBOARD_PATH]: DASHBOARD_OK })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('版本 v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText('模式 standalone')).toBeInTheDocument()

    // Dashboard 统计
    await waitFor(() => {
      expect(screen.getByText('资源总数')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
    })
    expect(screen.getByText('待确认配置草稿数')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('已纳管网域数')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    // 最近下发记录
    expect(screen.getByText('CHG-001')).toBeInTheDocument()
    expect(screen.getByText('政务网A区')).toBeInTheDocument()
  })

  it('renders friendly empty state when there are no recent deployments', async () => {
    setupMock({ [STATUS_PATH]: STATUS_OK, [DASHBOARD_PATH]: DASHBOARD_EMPTY })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('暂无下发记录')).toBeInTheDocument()
    })
  })

  it('renders error message when status API returns error status', async () => {
    setupMock({
      [STATUS_PATH]: { status: 'error', data: null, error: 'status service unreachable' },
      [DASHBOARD_PATH]: DASHBOARD_OK,
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
    setupMock({
      [STATUS_PATH]: STATUS_OK,
      [DASHBOARD_PATH]: { status: 'error', data: null, error: 'dashboard service unreachable' },
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('dashboard service unreachable')).toBeInTheDocument()
    })
  })
})