import { describe, it, expect } from 'vitest'
import { aggregateJobStatus } from './jobStatus'

describe('aggregateJobStatus (v3 sync aware)', () => {
  it('keeps draft/disabled precedence', () => {
    expect(aggregateJobStatus({ draft_status: 'draft', sync: { status: 'synced' } }).label).toBe('草稿')
    expect(aggregateJobStatus({ enabled: false, sync: { status: 'synced' } }).label).toBe('已停用')
  })

  it('prefers v3 sync states over change_status', () => {
    expect(aggregateJobStatus({ enabled: true, sync: { status: 'synced' }, change_status: 'pending' }).label).toBe('已同步')
    expect(aggregateJobStatus({ enabled: true, sync: { status: 'failed' } }).label).toBe('同步失败')
    expect(aggregateJobStatus({ enabled: true, sync: { status: 'pending' } }).label).toBe('待同步')
  })

  it('falls back to legacy change_status', () => {
    expect(aggregateJobStatus({ enabled: true, change_status: 'deployed' }).label).toBe('已生效')
    expect(aggregateJobStatus({ enabled: true, change_status: 'pending' }).label).toBe('待生效')
  })
})
