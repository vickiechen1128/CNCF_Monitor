import { describe, it, expect } from 'vitest'
import {
  queryEnvelope,
  queryTemplates,
  scrapeTargets,
  coverageStats,
  prometheusAlerts,
  tenant,
  type TargetStatus,
  type AlertState,
  type AlertSeverity,
} from './module-02'

describe('module-02 mocks（对齐 PRD v1.3）', () => {
  it('tenant 为单网域默认模式（multi_site_enabled=false）', () => {
    expect(tenant.multi_site_enabled).toBe(false)
    expect(tenant.tenant_id).toBe('tenant-a')
  })

  it('envelope 支持多网域数组且 data_source 细化到网域（PRD 6.1）', () => {
    expect(queryEnvelope.status).toBe('success')
    expect(queryEnvelope.meta.network_domains).toEqual(expect.arrayContaining(['default', 'gov-cloud-a']))
    expect(queryEnvelope.meta.data_source_by_domain).toBeDefined()
    expect(Object.keys(queryEnvelope.meta.data_source_by_domain ?? {}).length).toBeGreaterThan(0)
  })

  it('查询结果每条时序均携带 network_domain 注入标签', () => {
    queryEnvelope.data.result.forEach((r) => {
      expect(r.metric.network_domain).toBeTruthy()
    })
  })

  it('查询模板覆盖 CPU / 内存 / 拨测 / 跨网域等常用场景', () => {
    expect(queryTemplates.length).toBeGreaterThanOrEqual(6)
    expect(queryTemplates.some((t) => t.name.includes('拨测'))).toBe(true)
    expect(queryTemplates.some((t) => t.expr.includes('network_domain'))).toBe(true)
  })

  it('targets 的 status 枚举合法，blackbox job 携带拨测结果字段（PRD 3.2）', () => {
    const validStatuses: TargetStatus[] = ['up', 'down', 'unknown']
    scrapeTargets.forEach((t) => {
      expect(validStatuses).toContain(t.status)
      expect(t.network_domain).toBeTruthy()
    })
    const blackboxTargets = scrapeTargets.filter((t) => t.job.startsWith('blackbox'))
    expect(blackboxTargets.length).toBeGreaterThan(0)
    blackboxTargets.forEach((t) => {
      expect(typeof t.probe_success).toBe('boolean')
      expect(typeof t.probe_duration_seconds).toBe('number')
    })
  })

  it('down 目标携带最近错误信息', () => {
    const downTargets = scrapeTargets.filter((t) => t.status === 'down')
    expect(downTargets.length).toBeGreaterThan(0)
    downTargets.forEach((t) => expect(t.last_error.length).toBeGreaterThan(0))
  })

  it('覆盖率按网域统计且三态字段非负（v0.2，M07 三态 badge 数据来源）', () => {
    coverageStats.forEach((s) => {
      expect(s.domain).toBeTruthy()
      expect(s.monitored_up).toBeGreaterThanOrEqual(0)
      expect(s.monitored_down).toBeGreaterThanOrEqual(0)
      expect(s.unmonitored).toBeGreaterThanOrEqual(0)
    })
  })

  it('告警枚举合法（v0.3 alerts 代理数据契约）', () => {
    const validStates: AlertState[] = ['firing', 'pending']
    const validSeverities: AlertSeverity[] = ['critical', 'warning', 'info']
    prometheusAlerts.forEach((a) => {
      expect(validStates).toContain(a.state)
      expect(validSeverities).toContain(a.severity)
      expect(a.network_domain).toBeTruthy()
    })
  })
})
