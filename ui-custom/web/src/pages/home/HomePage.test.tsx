import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { HomePage } from './HomePage'

const mockGet = vi.fn()

vi.mock('../../api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}))

vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: ReactNode }) => <div data-testid="main-layout">{children}</div>,
}))

describe('HomePage', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders system status from API response', async () => {
    mockGet.mockResolvedValue({
      status: 'success',
      data: { version: 'v0.1.0', mode: 'standalone' },
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('v0.1.0')).toBeInTheDocument()
    })
    expect(screen.getByText('standalone')).toBeInTheDocument()
  })

  it('renders error message when API returns error status', async () => {
    mockGet.mockResolvedValue({
      status: 'error',
      data: null,
      error: 'status service unreachable',
    })

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('status service unreachable')).toBeInTheDocument()
    })
  })

  it('renders error message when request throws', async () => {
    mockGet.mockRejectedValue(new Error('network failure'))

    render(<HomePage />)

    await waitFor(() => {
      expect(screen.getByText('network failure')).toBeInTheDocument()
    })
  })
})
