import { describe, it, expect } from 'vitest'
import { compareVersions, formatBacklogBytes, latestPackageVersion } from './edgeConstants'

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
})