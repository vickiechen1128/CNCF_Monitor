import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { UsersPage } from './UsersPage'
import { setupAntdTest, mockAntdModal } from '../../../test/antdTestUtils'
import type { UserItem } from '../../../types/admin'

const useUsersMock = vi.fn()
const reloadMock = vi.fn()
const updateStatusMock = vi.fn()
const removeMock = vi.fn()

// 当前登录用户角色可控 store：默认管理员；普通用户只读用例中改为 user。
const { userStore } = vi.hoisted(() => ({ userStore: { role: 'admin' } }))

vi.mock('../../../api/admin', () => ({
  userApi: {
    updateStatus: (...a: unknown[]) => updateStatusMock(...a),
    remove: (...a: unknown[]) => removeMock(...a),
    list: vi.fn(),
  },
}))
vi.mock('../../../api/client', () => ({
  getStoredUser: () => ({
    id: 'u-current',
    username: 'admin',
    display_name: '系统管理员',
    tenant_id: 'platform_admin',
    role: userStore.role,
  }),
}))
vi.mock('./useUsers', () => ({ useUsers: (...a: unknown[]) => useUsersMock(...a) }))
vi.mock('./UserFormModal', () => ({ UserFormModal: () => null }))
vi.mock('./ResetPasswordModal', () => ({ ResetPasswordModal: () => null }))

const userRow = (id: string, username: string, extra: Partial<UserItem> = {}): UserItem => ({
  id,
  username,
  display_name: username,
  status: 'active',
  last_login_at: '',
  created_at: '2026-08-21T00:00:00Z',
  ...extra,
})

function result(over: Record<string, unknown> = {}) {
  return {
    data: { items: [] as UserItem[], total: 0 },
    loading: false,
    error: null,
    reload: reloadMock,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersPage />
    </MemoryRouter>,
  )
}

describe('UsersPage', () => {
  setupAntdTest()

  beforeEach(() => {
    useUsersMock.mockReset()
    reloadMock.mockReset()
    updateStatusMock.mockReset()
    removeMock.mockReset()
    updateStatusMock.mockResolvedValue({ status: 'success', data: {} })
    removeMock.mockResolvedValue({ status: 'success', data: null })
  })

  afterEach(() => {
    userStore.role = 'admin'
  })

  it('shows loading spinner while loading', () => {
    useUsersMock.mockReturnValue(result({ loading: true }))
    const { container } = renderPage()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
  })

  it('renders user rows on success', async () => {
    useUsersMock.mockReturnValue(
      result({ data: { items: [userRow('u1', 'ops01', { display_name: '运维一号' })], total: 1 } }),
    )
    renderPage()
    expect(await screen.findByText('ops01')).toBeInTheDocument()
    expect(screen.getByText('运维一号')).toBeInTheDocument()
  })

  it('renders empty state with 新建用户 guidance', async () => {
    useUsersMock.mockReturnValue(result())
    renderPage()
    expect(await screen.findByText('暂无用户')).toBeInTheDocument()
    expect(screen.getAllByText('新建用户').length).toBeGreaterThanOrEqual(1)
  })

  it('renders error Alert and reload button triggers reload', async () => {
    useUsersMock.mockReturnValue(result({ error: 'boom' }))
    renderPage()
    expect(await screen.findByText('用户列表加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /重新加载/ }))
    expect(reloadMock).toHaveBeenCalled()
  })

  it('disables user only after double-确认 Modal.confirm', async () => {
    const modal = mockAntdModal()
    useUsersMock.mockReturnValue(
      result({ data: { items: [userRow('u1', 'ops01')], total: 1 } }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /禁用/ }))
    expect(modal.confirm).toHaveBeenCalled()
    expect(updateStatusMock).not.toHaveBeenCalled()
    // 确认后才提交
    const onOk = modal.confirm.mock.calls[0][0].onOk
    await onOk?.()
    expect(updateStatusMock).toHaveBeenCalledWith('u1', 'disabled')
    expect(reloadMock).toHaveBeenCalled()
  })

  it('does not allow disabling current logged-in user', async () => {
    useUsersMock.mockReturnValue(
      result({ data: { items: [userRow('u-current', 'admin')], total: 1 } }),
    )
    renderPage()
    const disableBtn = await screen.findByRole('button', { name: /禁用/ })
    expect(disableBtn).toBeDisabled()
  })

  it('enables a disabled user directly without confirm', async () => {
    const modal = mockAntdModal()
    useUsersMock.mockReturnValue(
      result({ data: { items: [userRow('u1', 'ops01', { status: 'disabled' })], total: 1 } }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /启用/ }))
    expect(modal.confirm).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(updateStatusMock).toHaveBeenCalledWith('u1', 'active'))
  })

  it('deletes an ordinary user only after 确认 Modal.confirm', async () => {
    const modal = mockAntdModal()
    useUsersMock.mockReturnValue(
      result({ data: { items: [userRow('u2', 'ops02', { role: 'user' })], total: 1 } }),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /删除/ }))
    expect(modal.confirm).toHaveBeenCalled()
    expect(removeMock).not.toHaveBeenCalled()
    const onOk = modal.confirm.mock.calls[0][0].onOk
    await onOk?.()
    expect(removeMock).toHaveBeenCalledWith('u2')
    expect(reloadMock).toHaveBeenCalled()
  })

  it('hides management actions and 新建用户 for ordinary user（只读）', async () => {
    userStore.role = 'user'
    useUsersMock.mockReturnValue(
      result({ data: { items: [userRow('u1', 'ops01', { display_name: '运维一号' })], total: 1 } }),
    )
    renderPage()
    expect(await screen.findByText('ops01')).toBeInTheDocument()
    // 普通用户不展示任何管理操作与新建入口
    expect(screen.queryByRole('button', { name: /新建用户/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /禁用/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
    expect(screen.getByText('仅管理员可操作')).toBeInTheDocument()
  })
})