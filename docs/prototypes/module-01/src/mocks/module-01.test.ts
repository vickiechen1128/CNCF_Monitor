import { describe, it, expect } from 'vitest'
import {
  CI_TYPES,
  CI_TYPES_BY_CATEGORY,
  ENV_VALUES,
  ENV_LABEL,
  METRIC_TYPES,
  NETWORK_DOMAIN_IDS,
  STATUS_VALUES,
  STATUS_LABEL,
  currentTenant,
  mockBusinessMetrics,
  mockCITypeExporterMappings,
  mockExporterInstallations,
  mockExporterTemplates,
  mockLabelTemplates,
  mockMetricLibrary,
  mockMonitoringRules,
  mockNetworkDomains,
  mockResources,
  mockScrapeJobs,
} from './module-01'

describe('module-01 mocks（对齐 PRD v2.3）', () => {
  const templateIds = new Set(mockExporterTemplates.map((t) => t.exporter_template_id))
  const resourceIds = new Set(mockResources.map((r) => r.resource_id))
  const metricNames = new Set(mockMetricLibrary.filter((m) => m.enabled).map((m) => m.metric_name))

  it('network_domain_id 非空且为规范值（default / gov-cloud-a / finance-dmz）', () => {
    // finance-dmz 为离线、未纳管网域（is_monitored=false），仅出现在 NETWORK_DOMAIN_IDS，不在 MONITORED_NETWORK_DOMAINS
    expect(NETWORK_DOMAIN_IDS).toEqual(['default', 'gov-cloud-a', 'finance-dmz'])
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

  it('CITypeExporterMapping 引用的 label_template_id 均指向已存在的标签模板（模板 ID 为跨模块唯一 FK）', () => {
    const labelTemplateIds = new Set(mockLabelTemplates.map((t) => t.template_id))
    mockCITypeExporterMappings
      .filter((m) => m.label_template_id)
      .forEach((m) => expect(labelTemplateIds.has(m.label_template_id!)).toBe(true))
  })

  it('标签模板提供 mappings 只读预览数据且 target_label 唯一、来源类型合法（Module_07 维护）', () => {
    const validSources = ['resource_field', 'prometheus_builtin', 'composite', 'cmdb_field']
    mockLabelTemplates.forEach((t) => {
      expect(Array.isArray(t.mappings)).toBe(true)
      expect(t.mappings.length).toBeGreaterThan(0)
      t.mappings.forEach((m) => {
        expect(validSources).toContain(m.source_type)
        expect(m.source_field).toBeTruthy()
        expect(m.target_label).toBeTruthy()
      })
      const labels = t.mappings.map((m) => m.target_label)
      expect(new Set(labels).size).toBe(labels.length)
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

  it('MetricLibraryItem 的 metric_type 在 counter/gauge/histogram/summary/unknown 内；{v3.8} 主锚点 resource_types 非空且 CI 类型合法', () => {
    mockMetricLibrary.forEach((m) => {
      expect(METRIC_TYPES).toContain(m.metric_type)
      expect(typeof m.is_builtin).toBe('boolean')
      expect(typeof m.enabled).toBe('boolean')
      // {v3.8} 主锚点：每个指标至少挂一个 CI 类型
      expect(Array.isArray(m.resource_types)).toBe(true)
      expect(m.resource_types.length).toBeGreaterThan(0)
      m.resource_types.forEach((rt) => expect(CI_TYPES).toContain(rt.resource_type))
      // {v3.8} exporter_template_id 降级为「建议采集器」可空外键；存在时指向已登记的采集实现
      if (m.exporter_template_id) {
        expect(templateIds.has(m.exporter_template_id)).toBe(true)
      }
    })
  })

  it('{v3.8} MVP 内置指标库按 CI 类型组织（host_linux/host_windows/mysql/redis/kafka/application_http/snmp），来源采集器标注完整', () => {
    const byType = mockMetricLibrary.reduce<Record<string, number>>((acc, m) => {
      m.resource_types.forEach((rt) => {
        acc[rt.resource_type] = (acc[rt.resource_type] ?? 0) + 1
      })
      return acc
    }, {})
    // {v3.11} host 按 os_type 拆分为 host_linux / host_windows
    expect(byType['host_linux']).toBeGreaterThanOrEqual(30)
    expect(byType['host_windows']).toBeGreaterThanOrEqual(5)
    expect(byType['mysql']).toBeGreaterThanOrEqual(20)
    expect(byType['redis']).toBeGreaterThanOrEqual(20)
    expect(byType['kafka']).toBeGreaterThanOrEqual(20)
    expect(byType['application_http']).toBeGreaterThanOrEqual(10)
    expect(byType['snmp']).toBeGreaterThanOrEqual(5)
    // 来源采集器标注：application_http 下应同时存在 et-app（Spring Boot）与 et-app-go（Go）来源
    const appSources = new Set(
      mockMetricLibrary
        .filter((m) => m.resource_types.some((rt) => rt.resource_type === 'application_http'))
        .flatMap((m) => m.resource_types.map((rt) => rt.source_exporter))
    )
    expect(appSources.has('et-app')).toBe(true)
    expect(appSources.has('et-app-go')).toBe(true)
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

  it('actual_port 为可选字段，存在时为合法端口（P1，PRD 5.6 v2.7）', () => {
    mockExporterInstallations.forEach((c) => {
      if (c.actual_port !== undefined) {
        expect(c.actual_port).toBeGreaterThanOrEqual(1)
        expect(c.actual_port).toBeLessThanOrEqual(65535)
      }
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

  // ========== 业务指标库（PRD 5.9 {v3.5}/{v3.6}） ==========

  it('业务指标库 mock：owner 必填、register_source/status 值合法（PRD 5.9）', () => {
    expect(mockBusinessMetrics.length).toBeGreaterThan(0)
    mockBusinessMetrics.forEach((m) => {
      expect(m.owner).toBeTruthy()
      expect(['self', 'agent']).toContain(m.register_source)
      expect(['pending', 'instrumented', 'online']).toContain(m.status)
    })
  })

  it('业务指标状态机：pending→instrumented→online 单向推进契约（PRD 5.9）', () => {
    const order = ['pending', 'instrumented', 'online']
    mockBusinessMetrics.forEach((m) => {
      expect(order.indexOf(m.status)).toBeGreaterThanOrEqual(0)
    })
  })

  // ========== {v3.7}/{v3.8} 业务服务仍属 application_http + 采集实现 + 业务视图聚合 ==========

  it('{v3.8} 业务服务仍属 application_http：et-app-go 为采集实现（is_builtin=false，/metrics），映射 map-009 存在且非默认', () => {
    const goTpl = mockExporterTemplates.find((t) => t.exporter_template_id === 'et-app-go')
    expect(goTpl).toBeTruthy()
    expect(goTpl!.is_builtin).toBe(false)
    expect(goTpl!.supported_resource_types).toContain('application_http')
    expect(goTpl!.metrics_path).toBe('/metrics')
    const map009 = mockCITypeExporterMappings.find((m) => m.mapping_id === 'map-009')
    expect(map009).toBeTruthy()
    expect(map009!.resource_type).toBe('application_http')
    expect(map009!.exporter_template_id).toBe('et-app-go')
    expect(map009!.is_builtin).toBe(false)
    // {v3.8} 同一 CI 类型多个采集实现：application_http 默认 map-007（et-app），map-009 非默认
    expect(map009!.is_default).toBe(false)
    expect(mockCITypeExporterMappings.find((m) => m.mapping_id === 'map-007')!.is_default).toBe(true)
    // 业务服务（含自定义微服务）不新增 CI 类型：application_http 仍是唯一 application 细粒度类型
    expect(CI_TYPES).not.toContain('custom_service')
    expect(CI_TYPES.filter((t) => CI_TYPES_BY_CATEGORY.application?.includes(t))).toEqual(['application_http'])
  })

  it('{v3.7}/{v3.8} 自定义微服务采集链路闭环：job-007 引用采集实现 et-app-go 且选中实例为 order-go-service（res-app-003，business_domain=order）', () => {
    const job = mockScrapeJobs.find((j) => j.job_id === 'job-007')
    expect(job).toBeTruthy()
    expect(job!.exporter_template_id).toBe('et-app-go')
    expect(job!.resource_type).toBe('application_http')
    const res = mockResources.find((r) => r.resource_id === 'res-app-003')
    expect(res).toBeTruthy()
    expect(res!.business_domain).toBe('order')
    expect(job!.selected_instance_ids).toContain('res-app-003')
    // 业务指标 order_amount_total（biz-003，order 域）可经 app_name=order-service 关联到该 Job（采集落地链路可见）
    const biz = mockBusinessMetrics.find((b) => b.metric_id === 'biz-003')
    expect(biz!.app_name).toBe(res!.app_name)
  })

  it('{v3.7} 业务视图聚合数据完备：payment / order 域有成员与业务指标，采集落地列可关联 Job', () => {
    const domains = new Set(mockResources.filter((r) => r.business_domain).map((r) => r.business_domain))
    expect(domains.has('payment')).toBe(true)
    expect(domains.has('order')).toBe(true)
    mockBusinessMetrics.forEach((m) => {
      expect(m.business_domain).toBeTruthy()
    })
    // 业务指标 online 的（biz-001 pay-service）应有对应资源的采集 Job 关联
    const onlineBiz = mockBusinessMetrics.find((b) => b.status === 'online')
    expect(onlineBiz).toBeTruthy()
    const res = mockResources.find((r) => r.app_name === onlineBiz!.app_name)
    expect(res).toBeTruthy()
    expect(mockScrapeJobs.some((j) => j.selected_instance_ids.includes(res!.resource_id))).toBe(true)
  })
})
