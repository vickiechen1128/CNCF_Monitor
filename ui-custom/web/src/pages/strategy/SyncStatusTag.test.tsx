import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import SyncStatusTag from './SyncStatusTag'

afterEach(() => {
  cleanup()
})

describe('SyncStatusTag', () => {
  it('renders the v3 sync label', () => {
    render(<SyncStatusTag status="synced" />)
    expect(screen.getByTestId('sync-status-tag')).toHaveTextContent('已同步')
  })

  it('renders failed with the M09 error tooltip source', () => {
    render(
      <SyncStatusTag
        sync={{ status: 'failed', version: '', error: 'promtool rejected rule', synced_at: null }}
      />,
    )
    expect(screen.getByTestId('sync-status-tag')).toHaveTextContent('同步失败')
  })

  it('falls back to draft for a disabled job', () => {
    render(<SyncStatusTag enabled={false} />)
    expect(screen.getByTestId('sync-status-tag')).toHaveTextContent('已停用')
  })
})
