import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiClient, clearToken } from './client'
import { logout, LOGOUT_ENDPOINT } from './auth'

vi.mock('./client', () => ({
  apiClient: { post: vi.fn() },
  clearToken: vi.fn(),
}))

describe('logout', () => {
  beforeEach(() => {
    vi.mocked(apiClient.post).mockReset()
    vi.mocked(clearToken).mockReset()
  })

  it('calls the logout endpoint and clears local credentials', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ status: 'success' } as never)

    await logout()

    expect(apiClient.post).toHaveBeenCalledWith(LOGOUT_ENDPOINT)
    expect(clearToken).toHaveBeenCalledTimes(1)
  })

  it('still clears local credentials when the server call fails（会话已失效也要能退出）', async () => {
    vi.mocked(apiClient.post).mockRejectedValue(new Error('unauthorized'))

    await expect(logout()).resolves.toBeUndefined()

    expect(clearToken).toHaveBeenCalledTimes(1)
  })
})
