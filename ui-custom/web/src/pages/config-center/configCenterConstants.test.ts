import { describe, it, expect } from 'vitest'
import {
  CURRENT_USER,
  TOKEN_MASK,
  channelLabel,
  channelTip,
  changeTargetLabel,
  draftStatusLabel,
  deploymentStatusLabel,
  deriveRemoteWriteUrl,
  deriveRegistrationStatus,
  highestRisk,
} from './configCenterConstants'

describe('configCenterConstants（Module_09 契约映射）', () => {
  it('下发通道枚举映射与提示按契约 §8', () => {
    expect(channelLabel).toEqual({ local: 'local', agent_pull: 'agent_pull' })
    expect(channelTip.local).toContain('写盘')
    expect(channelTip.agent_pull).toContain('心跳')
  })

  it('Token 完全脱敏：TOKEN_MASK 不含明文', () => {
    expect(TOKEN_MASK).toBe('••••••••')
    expect(TOKEN_MASK).not.toMatch(/[a-z0-9]/i)
  })

  it('注册态由 is_monitored 派生', () => {
    expect(deriveRegistrationStatus({ is_monitored: true })).toBe('monitored')
    expect(deriveRegistrationStatus({ is_monitored: false })).toBe('created')
  })

  it('草稿/下发状态中文映射（契约 §10）', () => {
    expect(draftStatusLabel.pending).toBe('待确认')
    expect(draftStatusLabel.confirmed).toBe('已确认')
    expect(draftStatusLabel.discarded).toBe('已废弃')
    expect(deploymentStatusLabel.failed).toBe('失败')
    expect(deploymentStatusLabel.rolled_back).toBe('已回滚')
  })

  it('变更对象/变更类型映射（契约 §10）', () => {
    expect(changeTargetLabel.scrape_job).toBe('采集 Job')
    expect(changeTargetLabel.monitoring_rule).toBe('告警规则')
  })

  it('Remote Write URL 自动推导（决策 14），可手动覆盖', () => {
    expect(deriveRemoteWriteUrl('gov-cloud-a')).toContain('/api/v2/ingest/gov-cloud-a/prometheus')
  })

  it('最高风险取 change_items 中高风险', () => {
    expect(highestRisk([{ risk: 'low' }, { risk: 'high' }])).toBe('high')
    expect(highestRisk([{ risk: 'low' }])).toBe('low')
    expect(highestRisk(undefined)).toBe('low')
  })

  it('MVP 预置确认人', () => {
    expect(CURRENT_USER).toBe('张伟（运维）')
  })
})