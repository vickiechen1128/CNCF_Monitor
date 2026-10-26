import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { DashboardPanelsPage } from './DashboardPanelsPage'

const TEST_URL = 'http://1.15.11.216:3000/d/StarsL-TenSunS-node/e4b8bb-e69cba-e79b91-e68ea7?var-interval=5m&from=now-30m&to=now&timezone=browser&var-instance=localhost:9100&var-device=$__all&refresh=1m'
const { listMock, createMock, getStoredUserMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  getStoredUserMock: vi.fn(),
}))

vi.mock('../../../api/dashboardPanels', () => ({
  dashboardPanelApi: { list: listMock, create: createMock },
}))

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/client')>()
  return { ...actual, getStoredUser: getStoredUserMock }
})

vi.mock('../../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const emptyList = {
  status: 'success',
  data: { list: [], total: 0, page: 1, page_size: 100 },
}

describe('DashboardPanelsPage', () => {
  setupAntdTest()

  beforeEach(() => {
    listMock.mockReset()
    createMock.mockReset()
    getStoredUserMock.mockReturnValue({ id: 'admin', username: 'admin', role: 'admin' })
    listMock.mockResolvedValue(emptyList)
  })

  it('creates a panel from the first-open form and reloads the list', async () => {
    const user = userEvent.setup()
    listMock
      .mockResolvedValueOnce(emptyList)
      .mockResolvedValueOnce({
        status: 'success',
        data: {
          list: [{ id: 1, name: '节点监控大屏', url: TEST_URL, created_at: '2026-10-26T12:00:00Z' }],
          total: 1,
          page: 1,
          page_size: 100,
        },
      })
    createMock.mockResolvedValue({ status: 'success', data: { id: 1, name: '节点监控大屏', url: TEST_URL } })
    render(<MemoryRouter><DashboardPanelsPage /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: '新增面板' }))
    expect(await screen.findByLabelText('面板名称')).toHaveValue('')
    await user.type(screen.getByLabelText('面板名称'), '节点监控大屏')
    await user.type(screen.getByLabelText('Grafana URL'), TEST_URL)
    await user.click(screen.getByRole('button', { name: '提交' }))

    await waitFor(() => expect(createMock).toHaveBeenCalledWith({ name: '节点监控大屏', url: TEST_URL }))
    expect(await screen.findByText('节点监控大屏')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledTimes(2)
  })

  it('shows empty and failure states', async () => {
    const { unmount } = render(<MemoryRouter><DashboardPanelsPage /></MemoryRouter>)
    expect(await screen.findByText('暂无挂载面板')).toBeInTheDocument()
    unmount()

    listMock.mockRejectedValueOnce(new Error('加载失败'))
    render(<MemoryRouter><DashboardPanelsPage /></MemoryRouter>)
    expect(await screen.findByText('加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })

  it('hides the create action from ordinary users', async () => {
    getStoredUserMock.mockReturnValue({ id: 'u1', username: 'user', role: 'user' })
    render(<MemoryRouter><DashboardPanelsPage /></MemoryRouter>)
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '新增面板' })).not.toBeInTheDocument()
  })
})
