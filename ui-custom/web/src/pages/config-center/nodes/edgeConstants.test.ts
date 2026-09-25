import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  configSyncDisplayBadgeStatus,
  configSyncDisplayLabel,
  formatBacklogBytes,
  isConfigSyncApplyFailed,
  isConfigSyncInProgress,
  latestPackageVersion,
  outOfSyncCauseAction,
  outOfSyncCauseHint,
} from './edgeConstants'

describe('edgeConstants 纯函数', () => {
  it('formatBacklogBytes 格式化回传积压（B/KB/MB/GB）', () => {
    expect(formatBacklogBytes(842)).toBe('842 B')
    expect(formatBacklogBytes(1048576)).toBe('1.0 MB')
    expect(formatBacklogBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBacklogBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
    expect(formatBacklogBytes(undefined)).toBe('-')
    expect(formatBacklogBytes(-1)).toBe('-')
  })

  it('compareVersions 语义化版本比较（去 v 前缀按段位）', () => {
    expect(compareVersions('v1.101.0', 'v1.152.0')).toBeLessThan(0)
    expect(compareVersions('v1.200.0', 'v1.101.0')).toBeGreaterThan(0)
    expect(compareVersions('v1.2.0', 'v1.2.0')).toBe(0)
    expect(compareVersions('v2.0.0', 'v1.9.9')).toBeGreaterThan(0)
  })

  it('latestPackageVersion 取版本号最大者；空返回 null', () => {
    expect(latestPackageVersion(['v1.2.0', 'v0.2.0', 'v1.15.0'])).toBe('v1.15.0')
    expect(latestPackageVersion([])).toBeNull()
  })

  it('配置同步「同步中」中间态：仅 out_of_sync + pull_pending 命中（F-16）', () => {
    expect(isConfigSyncInProgress('out_of_sync', 'pull_pending')).toBe(true)
    expect(isConfigSyncInProgress('out_of_sync', 'pending_draft')).toBe(false)
    expect(isConfigSyncInProgress('out_of_sync', 'local_reset')).toBe(false)
    expect(isConfigSyncInProgress('out_of_sync')).toBe(false)
    // cause 仅对 out_of_sync 生效：in_sync 即使残留 cause 也按状态展示
    expect(isConfigSyncInProgress('in_sync', 'pull_pending')).toBe(false)
  })

  it('「同步失败」判定（D-2）：仅 out_of_sync + apply_failed 命中，且不命中「同步中」', () => {
    expect(isConfigSyncApplyFailed('out_of_sync', 'apply_failed')).toBe(true)
    expect(isConfigSyncApplyFailed('out_of_sync', 'pull_pending')).toBe(false)
    expect(isConfigSyncApplyFailed('out_of_sync', 'pending_draft')).toBe(false)
    expect(isConfigSyncApplyFailed('out_of_sync')).toBe(false)
    // 反例：apply_failed 是「同步失败」，绝不能误判为「同步中」（决策 4）
    expect(isConfigSyncInProgress('out_of_sync', 'apply_failed')).toBe(false)
  })

  it('configSyncDisplayLabel/BadgeStatus：pull_pending 展示「同步中」+ processing，其余与状态映射一致', () => {
    expect(configSyncDisplayLabel('out_of_sync', 'pull_pending')).toBe('同步中')
    expect(configSyncDisplayBadgeStatus('out_of_sync', 'pull_pending')).toBe('processing')

    // 其余 out_of_sync 成因（含空）仍「未同步」+ error
    expect(configSyncDisplayLabel('out_of_sync', 'pending_draft')).toBe('未同步')
    expect(configSyncDisplayBadgeStatus('out_of_sync', 'pending_draft')).toBe('error')
    expect(configSyncDisplayLabel('out_of_sync', 'local_reset')).toBe('未同步')
    expect(configSyncDisplayLabel('out_of_sync')).toBe('未同步')
    expect(configSyncDisplayBadgeStatus('out_of_sync')).toBe('error')

    // 非 out_of_sync 状态不受 cause 影响
    expect(configSyncDisplayLabel('in_sync', 'pull_pending')).toBe('已同步')
    expect(configSyncDisplayBadgeStatus('in_sync', 'pull_pending')).toBe('success')
    expect(configSyncDisplayLabel('unknown')).toBe('未知')
    expect(configSyncDisplayBadgeStatus('manual_override')).toBe('warning')
  })

  it('apply_failed 映射矩阵：展示「同步失败」+ error，并提供提示与「查看下发」引导（D-2）', () => {
    expect(configSyncDisplayLabel('out_of_sync', 'apply_failed')).toBe('同步失败')
    expect(configSyncDisplayBadgeStatus('out_of_sync', 'apply_failed')).toBe('error')
    // 与「同步中」「未同步」文案/色明确区分
    expect(configSyncDisplayLabel('out_of_sync', 'apply_failed')).not.toBe('未同步')
    expect(configSyncDisplayBadgeStatus('out_of_sync', 'apply_failed')).not.toBe('processing')
    // 非 out_of_sync 状态不受 apply_failed 影响
    expect(configSyncDisplayLabel('in_sync', 'apply_failed')).toBe('已同步')
    expect(configSyncDisplayBadgeStatus('in_sync', 'apply_failed')).toBe('success')
    // 提示与引导按钮
    expect(outOfSyncCauseHint.apply_failed).toContain('已回滚至上一可用版本')
    expect(outOfSyncCauseAction.apply_failed).toEqual({ text: '查看下发', target: '/deployments' })
  })
})