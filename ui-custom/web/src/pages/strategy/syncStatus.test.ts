import { describe, it, expect } from 'vitest'
import { aggregateJobSyncStatus, syncStatusView } from './syncStatus'

describe('syncStatusView', () => {
  it('maps v3 sync states to labels', () => {
    expect(syncStatusView('draft').label).toBe('草稿')
    expect(syncStatusView('pending').label).toBe('待同步')
    expect(syncStatusView('syncing').label).toBe('同步中')
    expect(syncStatusView('synced').label).toBe('已同步')
    expect(syncStatusView('failed').label).toBe('同步失败')
  })

  it('falls back to pending for unknown states', () => {
    expect(syncStatusView(undefined).label).toBe('待同步')
    expect(syncStatusView('legacy').label).toBe('待同步')
  })
})

describe('aggregateJobSyncStatus', () => {
  it('prefers draft status', () => {
    expect(aggregateJobSyncStatus({ draft_status: 'draft', sync: { status: 'synced', version: '', error: '', synced_at: null } }).label).toBe('草稿')
  })

  it('shows disabled before sync state', () => {
    expect(aggregateJobSyncStatus({ enabled: false, sync: { status: 'synced', version: '', error: '', synced_at: null } }).label).toBe('已停用')
  })

  it('uses the sync state when ready and enabled', () => {
    expect(aggregateJobSyncStatus({ enabled: true, sync: { status: 'synced', version: 'v1', error: '', synced_at: null } }).label).toBe('已同步')
    expect(aggregateJobSyncStatus({ enabled: true, sync: { status: 'failed', version: '', error: 'boom', synced_at: null } }).label).toBe('同步失败')
  })
})
