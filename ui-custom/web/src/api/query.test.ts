import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './client'
import { queryApi } from './query'

vi.mock('./client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

const getMock = apiClient.get as unknown as ReturnType<typeof vi.fn>

const MATRIX_RESPONSE = {
  status: 'success',
  data: { resultType: 'matrix', result: [] },
}

describe('queryApi', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('queryRange calls /api/v1/query_range with range params and abort signal', async () => {
    getMock.mockResolvedValue(MATRIX_RESPONSE)
    const controller = new AbortController()

    await queryApi.queryRange(
      { query: 'up', start: 0, end: 3600, step: 15 },
      { signal: controller.signal },
    )

    expect(getMock).toHaveBeenCalledWith('/api/v1/query_range', {
      params: { query: 'up', start: 0, end: 3600, step: 15 },
      signal: controller.signal,
    })
  })

  it('query keeps the instant-query contract', async () => {
    getMock.mockResolvedValue({ status: 'success', data: { resultType: 'vector', result: [] } })

    await queryApi.query({ query: 'up' })

    expect(getMock).toHaveBeenCalledWith('/api/v1/query', {
      params: { query: 'up' },
      signal: undefined,
    })
  })

  it('labelValues encodes the label name and forwards the optional window', async () => {
    getMock.mockResolvedValue({ status: 'success', data: ['node'] })

    await queryApi.labelValues('__name__', { start: 0, end: 3600 })

    expect(getMock).toHaveBeenCalledWith('/api/v1/label/__name__/values', {
      params: { start: 0, end: 3600 },
      signal: undefined,
    })
  })
})
