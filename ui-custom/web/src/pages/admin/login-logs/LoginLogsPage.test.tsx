import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LoginLogsPage } from './LoginLogsPage'
import { setupAntdTest } from '../../../test/antdTestUtils'
import type { LoginLogItem } from '../../../types/admin'

const useLoginLogsMock = vi.fn()
const setFiltersMock = vi.fn()
const onPageSizeChangeMock = vi.fn()
const reloadMock = vi.fn()

vi.mock('./useLoginLogs', () => ({ useLoginLogs: (...a: unknown[]) => useLoginLogsMock(...a) }))

const logRow = (id: string, username: string, success: boolean, extra: Partial<LoginLogItem> = {}): LoginLogItem => ({
  id,
  username,
  success,
  ip: '127.0.0.1',
  created_at: '2026-08-21T10:00:00Z',
  ...extra,
})

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [] as LoginLogItem[], total: 0 },
    loading: false,
    error: null,
    filters: {},
    setFilters: setFiltersMock,
    page: 1,
    pageSize: 20,
    onPageSizeChange: onPageSizeChangeMock,
    reload: reloadMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginLogsPage />
    </MemoryRouter>,
  )
}

describe('LoginLogsPage', () => {
  setupAntdTest()

  beforeEach(() => {
    useLoginLogsMock.mockReset()
    setFiltersMock.mockReset()
    onPageSizeChangeMock.mockReset()
    reloadMock.mockReset()
  })

  it('shows loading spinner while loading', () => {
    useLoginLogsMock.mockReturnValue(result({ loading: true }))
    const { container } = renderPage()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('renders login log rows (interface returns time-desc order)', async () => {
    useLoginLogsMock.mockReturnValue(
      result({
        data: {
          items: [
            logRow('1', 'admin', true, { ip: '10.0.0.1' }),
            logRow('2', 'ops01', false, { ip: '10.0.0.2' }),
          ],
          total: 2,
        },
      }),
    )
    renderPage()
    expect(await screen.findByText('admin')).toBeInTheDocument()
    expect(screen.getByText('ops01')).toBeInTheDocument()
    expect(screen.getAllByText('成功').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('失败').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument()
  })

  it('renders empty state', async () => {
    useLoginLogsMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无登录日志')).toBeInTheDocument()
  })

  it('renders error Alert and reload button triggers reload', async () => {
    useLoginLogsMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(await screen.findByText('登录日志加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('filters by username search', async () => {
    useLoginLogsMock.mockReturnValue(result({ filters: { username: 'ops' } }))
    renderPage()
    const search = screen.getByPlaceholderText('按用户名搜索')
    fireEvent.change(search, { target: { value: 'ops01' } })
    fireEvent.keyDown(search, { key: 'Enter', keyCode: 13 })
    expect(setFiltersMock).toHaveBeenCalledWith({ username: 'ops01' })
  })

  it('paginates via shared pagination onChange', () => {
    useLoginLogsMock.mockReturnValue(
      result({ data: { items: [logRow('1', 'admin', true)], total: 45 } }),
    )
    renderPage()
    const pager = screen.getByRole('listitem', { name: /下一页/ })
    fireEvent.click(pager)
    expect(onPageSizeChangeMock).toHaveBeenCalled()
  })
})