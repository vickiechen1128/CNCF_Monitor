import { describe, it, expect } from 'vitest'
import {
  ALL_STATUS_VALUES,
  CMDB_FIELD_OPTIONS,
  COMPOSITE_OPTIONS,
  ENV_VALUES,
  IMPORT_TEMPLATE_COLUMNS,
  LABEL_SOURCE_PRIORITY,
  MOCK_PROVIDERS,
  PROTECTED_PROMETHEUS_LABELS,
  PROMETHEUS_BUILTIN_OPTIONS,
  RESOURCE_FIELD_OPTIONS,
  STATUS_MAPPING_RULES,
  STATUS_VALUES,
  mockImportHistory,
  mockLabelTemplates,
  mockNetworkDomains,
  mockResourceLabels,
  mockResources,
  mockStatusMappingConfig,
  isApplicationResource,
  isGenericTargetResource,
  isHostResource,
  isMiddlewareResource,
} from './module-07'
import type { ResourceType } from './module-07'

describe('module-07 mocks（对齐 PRD v2.11）', () => {
  const domainIds = mockNetworkDomains.map((d) => d.id)

  // ========== 资源基础字段校验 ==========

  it('资源 env 取值均在 dev/test/staging/prod 枚举内（PRD 7.2）', () => {
    mockResources.forEach((r) => {
      if (r.env) expect(ENV_VALUES).toContain(r.env)
    })
  })

  it('资源 network_domain_id 非空且必须存在于网域列表（PRD 5.4）', () => {
    mockResources.forEach((r) => {
      expect(r.network_domain_id).toBeTruthy()
      expect(domainIds).toContain(r.network_domain_id)
    })
  })

  it('source_type 仅允许 manual / import，cmdb 为 v0.4+ 预留（PRD 5.2）', () => {
    mockResources.forEach((r) => {
      expect(['manual', 'import']).toContain(r.source_type)
    })
  })

  it('资源 status 仅允许 online/offline/maintenance，orphan 为 v0.4+ 预留不在 mock 中（PRD 5.2）', () => {
    mockResources.forEach((r) => {
      expect(STATUS_VALUES).toContain(r.status)
    })
  })

  it('资源 created_at / updated_at 非空且格式正确（PRD 5.2）', () => {
    const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    mockResources.forEach((r) => {
      expect(r.created_at).toMatch(datePattern)
      expect(r.updated_at).toMatch(datePattern)
    })
  })

  // ========== 四类资源必填字段 ==========

  it('host 资源包含 hostname 与 instance_ip 必填字段（PRD 5.6）', () => {
    const hosts = mockResources.filter(isHostResource)
    expect(hosts.length).toBeGreaterThan(0)
    hosts.forEach((r) => {
      expect(r.hostname).toBeTruthy()
      expect(r.instance_ip).toBeTruthy()
    })
  })

  it('middleware 资源包含 middleware_type / instance_ip / port 必填字段（PRD 5.7）', () => {
    const mws = mockResources.filter(isMiddlewareResource)
    expect(mws.length).toBeGreaterThan(0)
    mws.forEach((r) => {
      expect(r.middleware_type).toBeTruthy()
      expect(r.instance_ip).toBeTruthy()
      expect(r.port).toBeGreaterThanOrEqual(1)
      expect(r.port).toBeLessThanOrEqual(65535)
    })
  })

  it('application 资源包含 service_name 必填字段（PRD 5.8）', () => {
    const apps = mockResources.filter(isApplicationResource)
    expect(apps.length).toBeGreaterThan(0)
    apps.forEach((r) => expect(r.service_name).toBeTruthy())
  })

  it('generic_target 资源包含 target_name 与 instance_ip 必填字段（PRD 5.9）', () => {
    const gens = mockResources.filter(isGenericTargetResource)
    expect(gens.length).toBeGreaterThan(0)
    gens.forEach((r) => {
      expect(r.target_name).toBeTruthy()
      expect(r.instance_ip).toBeTruthy()
    })
  })

  // ========== is_monitored 只读字段 ==========

  it('is_monitored 字段存在且为布尔值（PRD 3.1/5.2，由 Module_01 维护）', () => {
    mockResources.forEach((r) => {
      expect(typeof r.is_monitored).toBe('boolean')
    })
  })

  // ========== v0.4+ 预留 CMDB 字段 ==========

  it('v0.4+ CMDB 字段（cmdb_ci_id 等）为可选，存在时非空（PRD 5.2/8）', () => {
    mockResources.forEach((r) => {
      if (r.cmdb_ci_id !== undefined) expect(r.cmdb_ci_id).toBeTruthy()
      if (r.cmdb_business_path !== undefined) expect(r.cmdb_business_path).toBeTruthy()
      if (r.cmdb_module_path !== undefined) expect(r.cmdb_module_path).toBeTruthy()
      if (r.cmdb_maintainer !== undefined) expect(r.cmdb_maintainer).toBeTruthy()
    })
  })

  // ========== 标签模板 ==========

  it('四类资源均预置默认标签模板且 mappings 非空（PRD 5.13）', () => {
    const types: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
    types.forEach((t) => {
      const defaults = mockLabelTemplates.filter((tpl) => tpl.resource_type === t && tpl.is_default)
      expect(defaults.length).toBeGreaterThanOrEqual(1)
      defaults.forEach((tpl) => expect(tpl.mappings.length).toBeGreaterThan(0))
    })
  })

  it('默认标签模板不使用 v0.4+ 的 cmdb_field 来源（PRD 5.11/5.13）', () => {
    mockLabelTemplates
      .filter((tpl) => tpl.is_default)
      .forEach((tpl) => {
        tpl.mappings.forEach((m) => expect(m.source_type).not.toBe('cmdb_field'))
      })
  })

  it('标签模板不绑定 job_id，只与资源类型绑定（PRD 5.10）', () => {
    mockLabelTemplates.forEach((tpl) => {
      expect(tpl).not.toHaveProperty('job_id')
      expect(['host', 'middleware', 'application', 'generic_target']).toContain(tpl.resource_type)
    })
  })

  it('标签模板 created_at / updated_at 非空（PRD 5.10）', () => {
    const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    mockLabelTemplates.forEach((tpl) => {
      expect(tpl.created_at).toMatch(datePattern)
      expect(tpl.updated_at).toMatch(datePattern)
    })
  })

  it('标签模板 mapping 的 source_type 仅允许四种合法值（PRD 5.11）', () => {
    const validSources = ['resource_field', 'prometheus_builtin', 'composite', 'cmdb_field']
    mockLabelTemplates.forEach((tpl) => {
      tpl.mappings.forEach((m) => {
        expect(validSources).toContain(m.source_type)
      })
    })
  })

  it('同一标签模板内 target_label 不允许重复（模板校验规则）', () => {
    mockLabelTemplates.forEach((tpl) => {
      const labels = tpl.mappings.map((m) => m.target_label)
      expect(new Set(labels).size).toBe(labels.length)
    })
  })

  it('模板名称不含「示例」字样（清理内置字段/采集参数示例模板，模板是业务标签契约而非内置参数透传）', () => {
    mockLabelTemplates.forEach((tpl) => {
      expect(tpl.name).not.toContain('示例')
    })
  })

  it('MVP 模板不映射 Prometheus 内置字段到自身（内置字段由 Prometheus 原生设置，无需模板透传）', () => {
    mockLabelTemplates.forEach((tpl) => {
      tpl.mappings.forEach((m) => {
        expect(m.source_type).not.toBe('prometheus_builtin')
      })
    })
  })

  it('MVP 转换规则值仅允许 空/lower/upper（prefix/replace 为 P1 参数化，不出现于 mock）', () => {
    const validTransforms = ['', 'lower', 'upper']
    mockLabelTemplates.forEach((tpl) => {
      tpl.mappings.forEach((m) => {
        expect(validTransforms).toContain(m.transform ?? '')
      })
    })
  })

  // ========== 保护 Prometheus label ==========

  it('PROTECTED_PROMETHEUS_LABELS 包含 instance / job / __address__ 等核心 label（PRD 5.3/3.3）', () => {
    expect(PROTECTED_PROMETHEUS_LABELS).toContain('instance')
    expect(PROTECTED_PROMETHEUS_LABELS).toContain('job')
    expect(PROTECTED_PROMETHEUS_LABELS).toContain('__address__')
    expect(PROTECTED_PROMETHEUS_LABELS).toContain('__name__')
  })

  it('标签模板映射的 target_label 不使用保护 label 作为目标（PRD 5.3/3.3）', () => {
    // 注意：prometheus_builtin 来源的映射可以将内置字段映射到同名 label（如 job → job），
    // resource_field / composite 来源不应映射到保护 label，但以下例外允许：
    // 1. composite 的 instance_ip:port → instance（Prometheus 标准 instance 映射）
    // 2. resource_field 的直接透传（source_field === target_label，如 scheme → scheme）
    mockLabelTemplates.forEach((tpl) => {
      tpl.mappings
        .filter((m) => m.source_type !== 'prometheus_builtin')
        .forEach((m) => {
          if (m.source_type === 'composite' && m.target_label === 'instance') return
          if (m.source_type === 'resource_field' && m.source_field === m.target_label) return
          expect(PROTECTED_PROMETHEUS_LABELS).not.toContain(m.target_label)
        })
    })
  })

  // ========== 状态映射规则 ==========

  it('STATUS_MAPPING_RULES 覆盖 online/offline/maintenance 三种目标状态（PRD 5.5.1）', () => {
    const targets = STATUS_MAPPING_RULES.map((r) => r.target)
    expect(targets).toContain('online')
    expect(targets).toContain('offline')
    expect(targets).toContain('maintenance')
  })

  it('STATUS_MAPPING_RULES 不包含 orphan 目标（orphan 为 v0.4+ 预留，PRD 5.5.1）', () => {
    const targets = STATUS_MAPPING_RULES.map((r) => r.target)
    expect(targets).not.toContain('orphan')
  })

  it('mockStatusMappingConfig 规则的 target_status 均在 ALL_STATUS_VALUES 内（PRD 5.5.3）', () => {
    mockStatusMappingConfig.rules.forEach((rule) => {
      expect(ALL_STATUS_VALUES).toContain(rule.target_status)
    })
  })

  it('mockStatusMappingConfig default_target 在 STATUS_VALUES 内（PRD 5.5.3）', () => {
    expect(STATUS_VALUES).toContain(mockStatusMappingConfig.default_target)
  })

  it('mockStatusMappingConfig 精确资源类型规则优先级高于 all 通用规则（PRD 5.5.4）', () => {
    const typedRules = mockStatusMappingConfig.rules.filter((r) => r.resource_type !== 'all')
    const allRules = mockStatusMappingConfig.rules.filter((r) => r.resource_type === 'all')
    if (typedRules.length > 0 && allRules.length > 0) {
      const minTypedPriority = Math.min(...typedRules.map((r) => r.priority))
      const maxAllPriority = Math.max(...allRules.map((r) => r.priority))
      expect(minTypedPriority).toBeGreaterThanOrEqual(maxAllPriority)
    }
  })

  // ========== 导入模板列 ==========

  it('IMPORT_TEMPLATE_COLUMNS 四类资源均包含 network_domain 列（PRD 7.1）', () => {
    const types: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
    types.forEach((t) => {
      expect(IMPORT_TEMPLATE_COLUMNS[t]).toContain('network_domain')
    })
  })

  it('IMPORT_TEMPLATE_COLUMNS host 包含 hostname/instance_ip 必填列（PRD 7.1/5.6）', () => {
    expect(IMPORT_TEMPLATE_COLUMNS.host).toContain('hostname')
    expect(IMPORT_TEMPLATE_COLUMNS.host).toContain('instance_ip')
  })

  it('IMPORT_TEMPLATE_COLUMNS middleware 包含 middleware_type/instance_ip/port 必填列（PRD 7.1/5.7）', () => {
    expect(IMPORT_TEMPLATE_COLUMNS.middleware).toContain('middleware_type')
    expect(IMPORT_TEMPLATE_COLUMNS.middleware).toContain('instance_ip')
    expect(IMPORT_TEMPLATE_COLUMNS.middleware).toContain('port')
  })

  it('IMPORT_TEMPLATE_COLUMNS application 包含 service_name 必填列（PRD 7.1/5.8）', () => {
    expect(IMPORT_TEMPLATE_COLUMNS.application).toContain('service_name')
  })

  it('IMPORT_TEMPLATE_COLUMNS generic_target 包含 target_name/instance_ip 必填列（PRD 7.1/5.9）', () => {
    expect(IMPORT_TEMPLATE_COLUMNS.generic_target).toContain('target_name')
    expect(IMPORT_TEMPLATE_COLUMNS.generic_target).toContain('instance_ip')
  })

  it('IMPORT_TEMPLATE_COLUMNS 四类资源均包含 status 列用于状态映射（PRD 7.1/5.5）', () => {
    const types: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
    types.forEach((t) => {
      expect(IMPORT_TEMPLATE_COLUMNS[t]).toContain('status')
    })
  })

  // ========== 导入记录 ==========

  it('导入记录 total = success + failed（PRD 7.3）', () => {
    mockImportHistory.forEach((record) => {
      expect(record.total).toBe(record.success + record.failed)
    })
  })

  it('导入记录 failed > 0 时 errors 非空，success 时 errors 为空（PRD 7.3）', () => {
    mockImportHistory.forEach((record) => {
      if (record.failed > 0) expect(record.errors.length).toBeGreaterThan(0)
      else expect(record.errors.length).toBe(0)
    })
  })

  it('导入记录 status 与 success/failed 一致（PRD 7.3）', () => {
    mockImportHistory.forEach((record) => {
      if (record.failed === 0 && record.success > 0) expect(record.status).toBe('success')
      else if (record.success === 0 && record.failed > 0) expect(record.status).toBe('failed')
      else if (record.success > 0 && record.failed > 0) expect(record.status).toBe('partial')
    })
  })

  // ========== ResourceLabel ==========

  it('mockResourceLabels 每条标签均包含 created_at / updated_at（PRD 5.3）', () => {
    const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    Object.values(mockResourceLabels).forEach((labels) => {
      labels.forEach((label) => {
        expect(label.created_at).toMatch(datePattern)
        expect(label.updated_at).toMatch(datePattern)
      })
    })
  })

  it('ResourceLabel source 仅允许 system/user/cmdb（PRD 5.3）', () => {
    const validSources = ['system', 'user', 'cmdb']
    Object.values(mockResourceLabels).forEach((labels) => {
      labels.forEach((label) => {
        expect(validSources).toContain(label.source)
      })
    })
  })

  it('LABEL_SOURCE_PRIORITY 优先级 cmdb > user > system（PRD 5.3）', () => {
    expect(LABEL_SOURCE_PRIORITY.cmdb).toBeGreaterThan(LABEL_SOURCE_PRIORITY.user)
    expect(LABEL_SOURCE_PRIORITY.user).toBeGreaterThan(LABEL_SOURCE_PRIORITY.system)
  })

  it('cmdb 来源标签 is_editable 为 false 且有 conflict_hint（PRD 5.3）', () => {
    Object.values(mockResourceLabels).forEach((labels) => {
      labels.filter((l) => l.source === 'cmdb').forEach((l) => {
        expect(l.is_editable).toBe(false)
        expect(l.conflict_hint).toBeTruthy()
      })
    })
  })

  it('user 来源标签可编辑性按资源类型区分（PRD 5.3/3.3 + {v2.8} 双场景治理：application 可编辑，静态资源 Excel/CMDB 带入只读）', () => {
    Object.values(mockResourceLabels).forEach((labels) => {
      labels.filter((l) => l.source === 'user').forEach((l) => {
        const res = mockResources.find((r) => r.resource_id === l.resource_id)
        if (res && isApplicationResource(res)) {
          expect(l.is_editable).toBe(true)
        } else {
          // {v2.8} 静态资源（host / middleware / generic_target）：标签治理在 CMDB/Excel 侧，user 来源为带入只读
          expect(l.is_editable).toBe(false)
        }
      })
    })
  })

  // ========== 字段选项完整性 ==========

  it('RESOURCE_FIELD_OPTIONS 四类资源均包含 network_domain_id（PRD 5.12 A）', () => {
    const types: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
    types.forEach((t) => {
      expect(RESOURCE_FIELD_OPTIONS[t]).toContain('network_domain_id')
    })
  })

  it('PROMETHEUS_BUILTIN_OPTIONS 不包含 __name__（PRD 5.12 B）', () => {
    expect(PROMETHEUS_BUILTIN_OPTIONS).not.toContain('__name__')
  })

  it('COMPOSITE_OPTIONS 包含 instance_ip:port（PRD 5.12 C）', () => {
    expect(COMPOSITE_OPTIONS).toContain('instance_ip:port')
  })

  it('CMDB_FIELD_OPTIONS 包含 cmdb_ci_id / cmdb_business_path 等 v0.4+ 字段（PRD 5.12 A/8）', () => {
    expect(CMDB_FIELD_OPTIONS).toContain('cmdb_ci_id')
    expect(CMDB_FIELD_OPTIONS).toContain('cmdb_business_path')
    expect(CMDB_FIELD_OPTIONS).toContain('cmdb_module_path')
    expect(CMDB_FIELD_OPTIONS).toContain('cmdb_maintainer')
  })

  // ========== CMDBProvider 扩展 ==========

  it('MOCK_PROVIDERS 包含 MVP 的 ExcelProvider/SQLiteProvider（PRD 8）', () => {
    const activeProviders = MOCK_PROVIDERS.filter((p) => p.status === 'active')
    expect(activeProviders.some((p) => p.name === 'ExcelProvider')).toBe(true)
    expect(activeProviders.some((p) => p.name === 'SQLiteProvider')).toBe(true)
  })

  it('MOCK_PROVIDERS v0.4+ provider 标记为 planned（PRD 8）', () => {
    const plannedProviders = MOCK_PROVIDERS.filter((p) => p.status === 'planned')
    expect(plannedProviders.length).toBeGreaterThan(0)
    plannedProviders.forEach((p) => {
      expect(p.version).toBe('v0.4+')
    })
  })
})
