import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncPolling } from './useSyncPolling'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useSyncPolling', () => {
  it('refreshes on the interval and stops after the duration', () => {
    const refresh = vi.fn()
    const { result } = renderHook(() => useSyncPolling(refresh, { durationMs: 3_000, intervalMs: 1_000 }))

    act(() => result.current())

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(refresh).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(refresh).toHaveBeenCalledTimes(2)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(refresh).toHaveBeenCalledTimes(3)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(refresh).toHaveBeenCalledTimes(3)
  })
})
