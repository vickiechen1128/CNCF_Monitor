import { describe, expect, it } from 'vitest'
import type { ResourceCategory } from '../../types/resource'
import {
  BUILTIN_FIELD_SCHEMA,
  FIELD_GROUP_LABEL,
  FIELD_GROUP_ORDER,
  builtinFieldKeys,
  groupBuiltinFields,
} from './resourceFieldSchema'

const CATEGORIES: ResourceCategory[] = [
  'host',
  'database',
  'middleware',
  'application',
  'interface_service',
  'generic_target',
]

describe('resourceFieldSchema', () => {
  it('六类 CI 都登记了内置字段，且 key 不重复', () => {
    for (const category of CATEGORIES) {
      const keys = builtinFieldKeys(category)
      expect(keys.length, category).toBeGreaterThan(0)
      expect(new Set(keys).size, `${category} has duplicate keys`).toBe(keys.length)
    }
  })

  it('分组只能是固定枚举，同组内排序值唯一', () => {
    for (const category of CATEGORIES) {
      const seenOrder = new Map<string, number>()
      for (const field of BUILTIN_FIELD_SCHEMA[category]) {
        expect(FIELD_GROUP_ORDER, `${category}.${field.key} group`).toContain(field.group)
        const orderKey = `${field.group}:${field.order}`
        expect(seenOrder.has(orderKey), `${category}.${field.key} duplicates order ${orderKey}`).toBe(false)
        seenOrder.set(orderKey, field.order)
      }
    }
  })

  it('身份字段与网域/环境/状态标记为必填', () => {
    for (const category of CATEGORIES) {
      const identity = BUILTIN_FIELD_SCHEMA[category].filter((field) => field.group === 'identity')
      expect(identity.length, category).toBeGreaterThan(0)
      for (const field of identity) {
        expect(field.required, `${category}.${field.key} must be required`).toBe(true)
      }
    }
    for (const category of CATEGORIES) {
      const keys = BUILTIN_FIELD_SCHEMA[category]
      expect(keys.find((field) => field.key === 'network_domain_id')?.required).toBe(true)
      expect(keys.find((field) => field.key === 'env')?.required).toBe(true)
      expect(keys.find((field) => field.key === 'status')?.required).toBe(true)
    }
  })

  it('采集语义与能力字段保留在 schema 中（不可被当成自定义字段删除）', () => {
    const hostKeys = builtinFieldKeys('host')
    expect(hostKeys).toContain('scrape_port')
    expect(hostKeys).toContain('has_npu')
    expect(hostKeys).toContain('has_gpu')
    expect(hostKeys).toContain('instance_ip')

    expect(builtinFieldKeys('generic_target')).toContain('metrics_path')
    expect(builtinFieldKeys('application')).toContain('endpoint')
    expect(builtinFieldKeys('database')).toContain('port')
  })

  it('接口服务不含平台归属字段（平台由所属应用主平台派生）', () => {
    expect(builtinFieldKeys('interface_service')).not.toContain('platform_code')
    expect(builtinFieldKeys('host')).toContain('platform_code')
  })

  it('groupBuiltinFields 按固定分组顺序返回，并带中文分组名', () => {
    const sections = groupBuiltinFields('host')
    const groups = sections.map((section) => section.group)
    const expected = FIELD_GROUP_ORDER.filter((group) => groups.includes(group))
    expect(groups).toEqual(expected)
    for (const section of sections) {
      expect(section.label).toBe(FIELD_GROUP_LABEL[section.group])
      expect(section.fields.length).toBeGreaterThan(0)
    }
  })
})
