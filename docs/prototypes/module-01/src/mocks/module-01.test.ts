import { describe, it, expect } from 'vitest'
import {
  CI_TYPES,
  ENV_VALUES,
  ENV_LABEL,
  METRIC_TYPES,
  NETWORK_DOMAIN_IDS,
  STATUS_VALUES,
  STATUS_LABEL,
  currentTenant,
  mockCITypeExporterMappings,
  mockExporterInstallations,
  mockExporterTemplates,
  mockMetricLibrary,
  mockMonitoringRules,
  mockNetworkDomains,
  mockResources,
  mockScrapeJobs,
} from './module-01'

describe('module-01 mocks（对齐 PRD v2.0）', () => {
  const templateIds = new Set(mockExporterTemplates.map((t) => t.exporter_template_id))
  const resourceIds = new Set(mockResources.map((r) => r.resource_id))
  const metricNames = new Set(mockMetricLibrary.filter((m) => m.enabled).map((m) => m.metric_name))

  it('network_domain_id 非空且为规范值（default / gov-cloud-a）', () => {
    expect(NETWORK_DOMAIN_IDS).toEqual(['default', 'gov-cloud-a'])
    mockNetworkDomains.forEach((d) => {
      expect(d.id).toBeTruthy()
      expect(NETWORK_DOMAIN_IDS).toContain(d.id)
    })
  })

  it('ScrapeJob / Resource 的 network_domain_id 均在规范网域内', () => {
    mockScrapeJobs.forEach((j) => expect(NETWORK_DOMAIN_IDS).toContain(j.network_domain_id))
    mockResources.forEach((r) => expect(NETWORK_DOMAIN_IDS).toContain(r.network_domain_id))
  })

  it('MVP ScrapeJob 的 instance_selection_mode 均为 manual（filter 为 v0.3+）', () => {
    expect(mockScrapeJobs.length).toBeGreaterThan(0)
    mockScrapeJobs.forEach((j) => {
      expect(j.instance_selection_mode).toBe('manual')
      expect(j.instance_filter).toBeNull()
    })
  })

  it('ScrapeJob 必填 job_type 且仅允许 standard / blackbox（PRD v2.0）', () => {
    mockScrapeJobs.forEach((j) => {
      expect(['standard', 'blackbox']).toContain(j.job_type)
      if (j.job_type === 'blackbox') {
        expect(j.blackbox_module).toBeTruthy()
        expect(j.blackbox_targets).toBeInstanceOf(Array)
        expect(j.blackbox_targets!.length).toBeGreaterThan(0)
      }
    })
  })

  it('ScrapeJob 的 relabel_configs 为空数组（P2 预留）且补齐 created_at/updated_at', () => {
    mockScrapeJobs.forEach((j) => {
      expect(j.relabel_configs).toEqual([])
      expect(j.created_at).toBeTruthy()
      expect(j.updated_at).toBeTruthy()
    })
  })

  it('决策 14：mock 演示「映射默认值已变更」场景（mapping_synced_at 早于映射 updated_at）', () => {
    const mappingById = new Map(
      mockCITypeExporterMappings.map((m) => [`${m.resource_type}:${m.exporter_template_id}`, m])
    )
    mockScrapeJobs
      .filter((j) => j.job_type === 'standard')
      .forEach((j) => {
        const mapping = mappingById.get(`${j.resource_type}:${j.exporter_template_id}`)
        if (!mapping) return
        if (!j.mapping_synced_at) return // 无快照视为已最新
        const changed = new Date(mapping.updated_at).getTime() > new Date(j.mapping_synced_at).getTime()
        // 演示场景：job-001（host）与 job-004（application_http）为「映射默认值已变更」
        if (j.job_id === 'job-001' || j.job_id === 'job-004') {
          expect(changed).toBe(true)
        }
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

  it('MonitoringRule 引用的指标名均存在于启用的指标库中（PRD v2.0 决策 5）', () => {
    const extractMetricNames = (expr: string): string[] => {
      if (!expr) return []
      const stripped = expr
        .replace(/"[^"]*"/g, '""')
        .replace(/\{[^}]*\}/g, '{}')
        .replace(/\[[^\]]*\]/g, '[]')
        .replace(/\b(?:by|without)\s*\([^)]*\)/gi, '')
      const matches = stripped.match(/[a-zA-Z_:][a-zA-Z0-9_:]*/g) ?? []
      const functions = new Set([
        'rate', 'irate', 'increase', 'sum', 'avg', 'min', 'max', 'count',
        'and', 'or', 'unless', 'on', 'ignoring', 'group_left', 'group_right',
        'offset', 'histogram_quantile', 'topk', 'bottomk', 'quantile',
        'predict_linear', 'changes', 'delta', 'deriv', 'idelta', 'resets',
        'absent', 'ceil', 'floor', 'round', 'abs', 'clamp_max', 'clamp_min',
        'clamp', 'time', 'vector', 'scalar', 'sort', 'sort_desc', 'sqrt',
        'ln', 'log2', 'log10', 'exp', 'sgn', 'deg', 'rad', 'pi', 'year',
        'month', 'day_of_month', 'day_of_week', 'days_in_month', 'hour',
        'minute', 'timestamp', 'label_replace', 'label_join', 'bool',
        'aggr_over_time', 'avg_over_time', 'min_over_time', 'max_over_time',
        'sum_over_time', 'count_over_time', 'quantile_over_time',
        'stddev_over_time', 'stdvar_over_time', 'last_over_time',
        'present_over_time', 'holt_winters', 'histogram_count', 'histogram_sum',
        'histogram_avg', 'histogram_stddev', 'histogram_stdvar',
        'histogram_fraction',
      ])
      return matches.filter((n) => !functions.has(n))
    }

    mockMonitoringRules.forEach((r) => {
      const used = extractMetricNames(r.expr)
      expect(used.length).toBeGreaterThan(0)
      used.forEach((name) => {
        expect(metricNames.has(name)).toBe(true)
      })
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

  it('MVP 内置指标库覆盖常见 Exporter（node/mysql/redis/kafka/blackbox/app/snmp）', () => {
    const groups = mockMetricLibrary.reduce<Record<string, number>>((acc, m) => {
      acc[m.exporter_template_id] = (acc[m.exporter_template_id] ?? 0) + 1
      return acc
    }, {})
    expect(groups['et-node']).toBeGreaterThanOrEqual(30)
    expect(groups['et-mysql']).toBeGreaterThanOrEqual(20)
    expect(groups['et-redis']).toBeGreaterThanOrEqual(20)
    expect(groups['et-kafka']).toBeGreaterThanOrEqual(20)
    expect(groups['et-blackbox']).toBeGreaterThanOrEqual(10)
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
      j.selected_instance_ids.forEach((id) => expect(resourceIds.has(id)).toBe(true))
    })
  })

  it('ExporterInstallationConfirmation 的 resource_id 均指向已存在的 Resource（PRD 5.6）', () => {
    mockExporterInstallations.forEach((c) => {
      expect(resourceIds.has(c.resource_id)).toBe(true)
      expect(templateIds.has(c.exporter_template_id)).toBe(true)
      expect(['pending', 'installed', 'not_installed', 'unregistered']).toContain(c.status)
    })
  })

  it('currentTenant 提供 multi_site_enabled 租户级开关（对齐 Module_09 / web-development 规范）', () => {
    expect(currentTenant).toHaveProperty('id')
    expect(typeof currentTenant.multi_site_enabled).toBe('boolean')
  })

  it('MonitoringRule 均携带 scope 且 MVP 阶段固定 central（PRD 5.5）', () => {
    mockMonitoringRules.forEach((r) => {
      expect(['central', 'edge', 'both']).toContain(r.scope)
      expect(r.scope).toBe('central')
    })
  })

  it('blackbox ScrapeJob 的 blackbox_targets 为对象数组且 target/protocol 合法（PRD v2.0）', () => {
    const protocols = ['http', 'https', 'tcp', 'icmp', 'dns']
    mockScrapeJobs
      .filter((j) => j.job_type === 'blackbox')
      .forEach((j) => {
        expect(Array.isArray(j.blackbox_targets)).toBe(true)
        j.blackbox_targets!.forEach((t) => {
          expect(typeof t.target).toBe('string')
          expect(t.target.length).toBeGreaterThan(0)
          expect(protocols).toContain(t.protocol)
          if (t.url) expect(typeof t.url).toBe('string')
        })
      })
  })

  it('ScrapeJob 的 mapping_overrides 字段名在映射继承参数候选集内（PRD v2.0 决策 14）', () => {
    const candidates = ['scrape_interval', 'scrape_timeout', 'metrics_path', 'scheme', 'label_template_id']
    mockScrapeJobs
      .filter((j) => j.job_type === 'standard')
      .forEach((j) => {
        (j.mapping_overrides ?? []).forEach((f) => {
          expect(candidates).toContain(f)
        })
      })
  })
})
