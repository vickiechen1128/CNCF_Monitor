import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../../test/antdTestUtils'
import { ResetPasswordModal } from './ResetPasswordModal'
import type { UserItem } from '../../../types/admin'

const resetMock = vi.fn()
const onCancelMock = vi.fn()
const onSuccessMock = vi.fn()

vi.mock('../../../api/admin', () => ({
  userApi: { resetPassword: (...a: unknown[]) => resetMock(...a) },
}))

const user: UserItem = { id: 'u1', username: 'ops01', display_name: '运维一号', status: 'active', last_login_at: '', created_at: '' }

describe('ResetPasswordModal', () => {
  setupAntdTest()

  beforeEach(() => {
    resetMock.mockReset()
    onCancelMock.mockReset()
    onSuccessMock.mockReset()
    resetMock.mockResolvedValue({ status: 'success', data: null })
  })

  it('submits new_password via resetPassword API and closes on success', async () => {
    render(
      <ResetPasswordModal open user={user} onCancel={onCancelMock} onSuccess={onSuccessMock} />,
    )
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'newpass123' } })
    fireEvent.click(screen.getByRole('button', { name: /确认重置/ }))
    await waitFor(() => {
      expect(resetMock).toHaveBeenCalledWith('u1', { new_password: 'newpass123' })
    })
    expect(onSuccessMock).toHaveBeenCalled()
    expect(onCancelMock).toHaveBeenCalled()
  })

  it('does not submit when new_password empty', async () => {
    render(
      <ResetPasswordModal open user={user} onCancel={onCancelMock} onSuccess={onSuccessMock} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /确认重置/ }))
    expect(resetMock).not.toHaveBeenCalled()
  })
})