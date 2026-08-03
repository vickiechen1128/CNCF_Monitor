import { describe, it, expect } from 'vitest'
import {
  CI_TYPES,
  ENV_VALUES,
  ENV_LABEL,
  METRIC_TYPES,
  NETWORK_DOMAIN_IDS,
  STATUS_VALUES,
  STATUS_LABEL,
  mockCITypeExporterMappings,
  mockExporterInstallations,
  mockExporterTemplates,
  mockMetricLibrary,
  mockMonitoringRules,
  mockNetworkDomains,
  mockProbes,
  mockResources,
  mockScrapeJobs,
} from './module-01'

describe('module-01 mocks（对齐 PRD v1.1）', () => {
  const templateIds = new Set(mockExporterTemplates.map((t) => t.exporter_template_id))
  const resourceIds = new Set(mockResources.map((r) => r.resource_id))

  it('network_domain_id 非空且为规范值（default / gov-cloud-a）', () => {
    expect(NETWORK_DOMAIN_IDS).toEqual(['default', 'gov-cloud-a'])
    mockNetworkDomains.forEach((d) => {
      expect(d.id).toBeTruthy()
      expect(NETWORK_DOMAIN_IDS).toContain(d.id)
    })
  })

  it('ScrapeJob / Probe / Resource 的 network_domain_id 均在规范网域内', () => {
    mockScrapeJobs.forEach((j) => expect(NETWORK_DOMAIN_IDS).toContain(j.network_domain_id))
    mockProbes.forEach((p) => expect(NETWORK_DOMAIN_IDS).toContain(p.network_domain_id))
    mockResources.forEach((r) => expect(NETWORK_DOMAIN_IDS).toContain(r.network_domain_id))
  })

  it('MVP ScrapeJob 的 instance_selection_mode 均为 manual（filter 为 v0.3+）', () => {
    expect(mockScrapeJobs.length).toBeGreaterThan(0)
    mockScrapeJobs.forEach((j) => {
      expect(j.instance_selection_mode).toBe('manual')
      expect(j.instance_filter).toBeNull()
    })
  })

  it('ScrapeJob 的 relabel_configs 为空数组（P2 预留）且补齐 created_at/updated_at', () => {
    mockScrapeJobs.forEach((j) => {
      expect(j.relabel_configs).toEqual([])
      expect(j.created_at).toBeTruthy()
      expect(j.updated_at).toBeTruthy()
    })
  })

  it('每个 CITypeExporterMapping 的 exporter_template_id 在 mockExporterTemplates 中存在', () => {
    mockCITypeExporterMappings.forEach((m) => {
      expect(templateIds.has(m.exporter_template_id)).toBe(true)
      expect(m.resource_type).toBeTruthy()
      expect(CI_TYPES).toContain(m.resource_type)
      expect(typeof m.is_builtin).toBe('boolean')
      expect(m.created_at).toBeTruthy()
      expect(m.updated_at).toBeTruthy()
    })
  })

  it('每个 MonitoringRule 的 exporter_template_id 在 mockExporterTemplates 中存在', () => {
    mockMonitoringRules.forEach((r) => {
      expect(templateIds.has(r.exporter_template_id)).toBe(true)
      expect(CI_TYPES).toContain(r.resource_type)
      expect(r.created_at).toBeTruthy()
      expect(r.updated_at).toBeTruthy()
    })
  })

  it('MonitoringRule recording 规则不携带 duration / annotations（PRD 5.5）', () => {
    mockMonitoringRules
      .filter((r) => r.rule_type === 'recording')
      .forEach((r) => {
        expect(r.duration).toBe('')
        expect(Object.keys(r.annotations).length).toBe(0)
      })
  })

  it('MetricLibraryItem 的 metric_type 在 counter/gauge/histogram/summary/unknown 内', () => {
    mockMetricLibrary.forEach((m) => {
      expect(METRIC_TYPES).toContain(m.metric_type)
      expect(typeof m.is_builtin).toBe('boolean')
      expect(typeof m.enabled).toBe('boolean')
      expect(templateIds.has(m.exporter_template_id)).toBe(true)
    })
  })

  it('内置指标 is_builtin=true（PRD 5.3）', () => {
    mockMetricLibrary
      .filter((m) => m.metric_name === 'node_cpu_seconds_total')
      .forEach((m) => expect(m.is_builtin).toBe(true))
  })

  it('ExporterTemplate 补齐 install_guide / is_builtin（PRD 5.2）', () => {
    mockExporterTemplates.forEach((t) => {
      expect(typeof t.install_guide).toBe('string')
      expect(t.install_guide.length).toBeGreaterThan(0)
      expect(typeof t.is_builtin).toBe('boolean')
    })
  })

  it('mockResources 的 env 值在 dev/test/staging/prod 内', () => {
    mockResources.forEach((r) => {
      expect(ENV_VALUES).toContain(r.env)
      expect(ENV_LABEL[r.env]).toBeTruthy()
      expect(STATUS_VALUES).toContain(r.status)
      expect(STATUS_LABEL[r.status]).toBeTruthy()
      expect(r.app_name).toBeTruthy()
      expect(r.cluster).toBeTruthy()
    })
  })

  it('ScrapeJob.selected_instance_ids 均指向已存在的 Resource', () => {
    mockScrapeJobs.forEach((j) => {
      j.selected_instance_ids.forEach((id) => expect(resourceIds.has(id)).toBe(true)
      )
    })
  })

  it('ExporterInstallationConfirmation 的 resource_id 均指向已存在的 Resource（PRD 5.6）', () => {
    mockExporterInstallations.forEach((c) => {
      expect(resourceIds.has(c.resource_id)).toBe(true)
      expect(templateIds.has(c.exporter_template_id)).toBe(true)
      expect(['pending', 'installed', 'not_installed', 'unregistered']).toContain(c.status)
    })
  })
})
