import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useDomains } from './useDomains'

const listMock = vi.fn()

vi.mock('../../../api/domain', () => ({
  networkDomainApi: { list: (...args: unknown[]) => listMock(...args) },
  isApiError: (e: unknown) =>
    !!e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 403,
}))

describe('useDomains', () => {
  beforeEach(() => {
    listMock.mockReset()
  })

  it('loads list on mount with default page', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ id: 'mc-a' }], total: 1, page: 1, page_size: 20 },
    })
    const { result } = renderHook(() => useDomains())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(listMock).toHaveBeenCalledWith({
      page: 1,
      page_size: 20,
      status: undefined,
      zone_type: undefined,
      tenant_id: undefined,
      name: undefined,
    })
    expect(result.current.data.total).toBe(1)
  })

  it('sends filters and resets page on setFilters', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 20 },
    })
    const { result } = renderHook(() => useDomains())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => {
      result.current.setFilters({ status: 'disabled', zone_type: 'internet' })
    })
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: 'disabled', zone_type: 'internet' }),
      ),
    )
  })

  it('sets error on request failure', async () => {
    listMock.mockRejectedValue(new Error('network down'))
    const { result } = renderHook(() => useDomains())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('network down')
  })

  it('marks permissionDenied on response signal', async () => {
    const err = new Error('forbidden')
    ;(err as unknown as { code: number }).code = 403
    listMock.mockRejectedValue(err)
    const { result } = renderHook(() => useDomains())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.permissionDenied).toBe(true)
  })
})
