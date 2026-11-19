import { describe, it, expect } from 'vitest'
import {
  CURRENT_USER,
  DOMAIN_FIELD_TIP,
  TOKEN_MASK,
  channelLabel,
  channelTip,
  changeTargetLabel,
  draftStatusLabel,
  deploymentStatusLabel,
  deriveRemoteWriteUrl,
  deriveRegistrationStatus,
  formatLocalDate,
  highestRisk,
} from './configCenterConstants'

describe('configCenterConstants（Module_09 契约映射）', () => {
  it('下发通道只剩采集节点拉取一种，且用户文案不出现 agent_pull 技术术语（SRS NFR-10）', () => {
    expect(channelLabel).toEqual({ agent_pull: '采集节点拉取' })
    expect(channelLabel.agent_pull).not.toContain('agent_pull')
    expect(channelTip.agent_pull).toContain('采集节点')
    // v3 取消「中心直连域」：不再有 local 通道文案 / 域类型「中心直连域」映射（SRS NFR-02）
    expect(Object.keys(channelLabel)).toEqual(['agent_pull'])
    expect(Object.keys(channelTip)).toEqual(['agent_pull'])
  })

  it('字段解释不再保留中心直连域相关说明', () => {
    expect(Object.keys(DOMAIN_FIELD_TIP)).not.toContain('channelLocal')
    expect(Object.keys(DOMAIN_FIELD_TIP)).not.toContain('agentTypeLocal')
    expect(JSON.stringify(DOMAIN_FIELD_TIP)).not.toContain('中心直连域')
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

  it('配置日期按本地自然日格式化', () => {
    expect(formatLocalDate('2026-11-18T10:00:00Z')).toMatch(/^2026-11-1[78]$/)
    expect(formatLocalDate('bad-date')).toBe('-')
    expect(formatLocalDate(null)).toBe('-')
  })

  it('MVP 预置确认人', () => {
    expect(CURRENT_USER).toBe('张伟（运维）')
  })
})