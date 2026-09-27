import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TargetStatusPage } from './TargetStatusPage'

const targetsListMock = vi.fn()
const domainListMock = vi.fn()

vi.mock('../../api/targets', () => ({
  targetsApi: { list: (...args: unknown[]) => targetsListMock(...args) },
}))

vi.mock('../../api/domain', () => ({
  networkDomainApi: { list: (...args: unknown[]) => domainListMock(...args) },
}))

// MainLayout 依赖路由上下文（useNavigate 等），用 MemoryRouter 包裹。
vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function target(resource_id: string, health: 'up' | 'down' | 'unknown', over: Record<string, unknown> = {}) {
  return {
    scrapePool: 'job-x',
    job: 'job-x',
    instance: `10.0.0.${resource_id.replace(/\D/g, '') || '8'}:9104`,
    network_domain: 'default',
    health,
    lastScrape: '2026-09-01T10:00:00Z',
    lastError: '',
    scrapeDuration: 0.02,
    resource_id,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <TargetStatusPage />
    </MemoryRouter>,
  )
}

describe('TargetStatusPage', () => {
  beforeEach(() => {
    targetsListMock.mockReset()
    domainListMock.mockReset()
    domainListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })
  })

  it('loads targets and renders rows with health badges', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: {
        activeTargets: [target('res-1', 'up'), target('res-2', 'down')],
        droppedTargets: [],
        targetsByJob: {},
      },
    })
    renderPage()
    // 页表仅渲染 job / instance / network_domain / health 等字段，实例地址即 resource_id 的派生展示
    expect(await screen.findByText('10.0.0.1:9104')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.2:9104')).toBeInTheDocument()
    expect(screen.getByText('在线')).toBeInTheDocument()
    expect(screen.getByText('离线')).toBeInTheDocument()
    expect(targetsListMock).toHaveBeenCalled()
  })

  it('renders empty state', async () => {
    targetsListMock.mockResolvedValue({ status: 'success', data: { activeTargets: [], droppedTargets: [], targetsByJob: {} } })
    renderPage()
    expect(await screen.findByText('暂无采集目标')).toBeInTheDocument()
  })

  it('renders error alert and reload retries', async () => {
    targetsListMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({
      status: 'success',
      data: { activeTargets: [target('res-1', 'up')], droppedTargets: [], targetsByJob: {} },
    })
    renderPage()
    expect(await screen.findByText('目标状态加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重新加载/ }))
    await waitFor(() => expect(targetsListMock).toHaveBeenCalledTimes(2))
  })

  it('filters by health', async () => {
    targetsListMock.mockResolvedValue({ status: 'success', data: { activeTargets: [], droppedTargets: [], targetsByJob: {} } })
    renderPage()
    await screen.findByText('暂无采集目标')
    fireEvent.mouseDown(screen.getByText('全部状态'))
    fireEvent.click(await screen.findByText('离线'))
    await waitFor(() =>
      expect(targetsListMock).toHaveBeenLastCalledWith(expect.objectContaining({ health: 'down' })),
    )
  })

  it('renders backend-resolved instance name column', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: {
        activeTargets: [
          target('res-1', 'up', { instance_name: 'GL_OPS_MONITOR_01_X86' }),
          target('res-2', 'up', { instance_name: '' }),
        ],
        droppedTargets: [],
        targetsByJob: {},
      },
    })
    renderPage()
    // 有实例名 → 展示；无 resource_id / 台账无此资源 → 降级 '-'
    expect(await screen.findByText('GL_OPS_MONITOR_01_X86')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.1:9104')).toBeInTheDocument()
  })

  it('passes instance name / IP search to backend on enter', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: {
        activeTargets: [target('res-1', 'up', { instance_name: 'GL_OPS_MONITOR_01_X86' })],
        droppedTargets: [],
        targetsByJob: {},
      },
    })
    renderPage()
    const input = await screen.findByPlaceholderText('搜索实例名或实例IP')
    fireEvent.change(input, { target: { value: ' GL_OPS ' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    await waitFor(() =>
      expect(targetsListMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'GL_OPS' })),
    )
  })

  it('clears search when input is emptied', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: { activeTargets: [], droppedTargets: [], targetsByJob: {} },
    })
    renderPage()
    const input = await screen.findByPlaceholderText('搜索实例名或实例IP')
    fireEvent.change(input, { target: { value: 'GL_OPS' } })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
    await waitFor(() =>
      expect(targetsListMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'GL_OPS' })),
    )
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() =>
      expect(targetsListMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined })),
    )
  })
})