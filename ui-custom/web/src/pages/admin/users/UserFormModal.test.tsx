import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { UserFormModal } from './UserFormModal'
import type { UserItem } from '../../../types/admin'

const createMock = vi.fn()
const updateMock = vi.fn()
const onCancelMock = vi.fn()
const onSuccessMock = vi.fn()

vi.mock('../../../api/admin', () => ({
  userApi: { create: (...a: unknown[]) => createMock(...a), update: (...a: unknown[]) => updateMock(...a) },
}))

const okButton = () => screen.getByRole('button', { name: /提\s*交/ })
const cancelButton = () => screen.getByRole('button', { name: /取\s*消/ })

function renderCreate(open = true) {
  return render(
    <UserFormModal
      open={open}
      mode="create"
      user={null}
      onCancel={onCancelMock}
      onSuccess={onSuccessMock}
    />,
  )
}

function renderEdit(user: UserItem) {
  return render(
    <UserFormModal open mode="edit" user={user} onCancel={onCancelMock} onSuccess={onSuccessMock} />,
  )
}

describe('UserFormModal', () => {
  setupAntdTest()

  beforeEach(() => {
    createMock.mockReset()
    updateMock.mockReset()
    onCancelMock.mockReset()
    onSuccessMock.mockReset()
    createMock.mockResolvedValue({ status: 'success', data: {} })
    updateMock.mockResolvedValue({ status: 'success', data: {} })
  })

  it('create mode: submits username/display_name/password via create API', async () => {
    renderCreate()
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'ops01' } })
    fireEvent.change(screen.getByLabelText('显示名称'), { target: { value: '运维一号' } })
    fireEvent.change(screen.getByLabelText('初始密码'), { target: { value: 'secret123' } })
    fireEvent.click(okButton())
    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith({
        username: 'ops01',
        display_name: '运维一号',
        password: 'secret123',
        role: 'user',
      })
    })
    expect(onSuccessMock).toHaveBeenCalled()
    expect(onCancelMock).toHaveBeenCalled()
  })

  it('edit mode: hides username input and submits only display_name via update API', async () => {
    renderEdit({ id: 'u1', username: 'ops01', display_name: '旧名', status: 'active', last_login_at: '', created_at: '' })
    // 用户名只读展示，不可编辑
    expect(screen.queryByLabelText('用户名')).toBeNull()
    expect(screen.getByRole('textbox', { name: '' })).toBeTruthy()
    const display = screen.getByLabelText('显示名称')
    expect(display).toHaveValue('旧名')
    fireEvent.change(display, { target: { value: '新名' } })
    fireEvent.click(okButton())
    await waitFor(() => {
      expect(updateMock).toHaveBeenCalledWith('u1', { display_name: '新名', role: 'user' })
    })
    expect(onSuccessMock).toHaveBeenCalled()
  })

  it('cancel triggers onCancel', () => {
    renderCreate()
    fireEvent.click(cancelButton())
    expect(onCancelMock).toHaveBeenCalled()
  })
})