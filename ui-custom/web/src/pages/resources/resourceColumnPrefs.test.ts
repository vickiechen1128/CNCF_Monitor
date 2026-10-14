import { describe, it, expect } from 'vitest'
import {
  RESOURCE_COLUMN_META,
  FIXED_COLUMN_KEYS,
  DEFAULT_VISIBLE_COLUMN_KEYS,
  orderColumnKeys,
} from './resourceColumnPrefs'
import type { ResourceCategory } from '../../types/resource'

const CATEGORIES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']

describe('resourceColumnPrefs（T01-P5）', () => {
  it('五类列 meta 均追加「采集端口」（key=scrape_port，技术属性 / 位置 分组）', () => {
    for (const category of CATEGORIES) {
      const found = RESOURCE_COLUMN_META[category].filter((m) => m.key === 'scrape_port')
      expect(found, `${category} 应恰有一个 scrape_port 列`).toHaveLength(1)
      expect(found[0].label).toBe('采集端口')
      expect(found[0].group).toBe('技术属性 / 位置')
    }
  })

  it('各类列 meta 的 key 全局在本类内唯一（scrape_port 不与既有列冲突）', () => {
    for (const category of CATEGORIES) {
      const keys = RESOURCE_COLUMN_META[category].map((m) => m.key)
      expect(new Set(keys).size, `${category} 列 key 应唯一`).toBe(keys.length)
    }
  })

  it('DEFAULT_VISIBLE_COLUMN_KEYS 与 FIXED_COLUMN_KEYS 不变（默认列集防回归）', () => {
    // PM 裁定的默认列集（F-17）：T01-P5 追加采集端口列**不改变**默认可见列
    expect(DEFAULT_VISIBLE_COLUMN_KEYS).toEqual({
      host: ['name', 'os_type', 'network_domain_id', 'status', 'monitor_state', 'actions'],
      database: ['instance_name', 'database_type', 'network_domain_id', 'status', 'monitor_state', 'actions'],
      middleware: ['instance_name', 'middleware_type', 'network_domain_id', 'status', 'monitor_state', 'actions'],
      application: ['service_name', 'network_domain_id', 'status', 'monitor_state', 'service_code', 'actions'],
      generic_target: ['target_name', 'network_domain_id', 'status', 'monitor_state', 'service_code', 'actions'],
    })
    expect(FIXED_COLUMN_KEYS).toEqual({
      host: ['name', 'actions'],
      database: ['instance_name', 'actions'],
      middleware: ['instance_name', 'actions'],
      application: ['service_name', 'actions'],
      generic_target: ['target_name', 'actions'],
    })
    // 默认集均不含 scrape_port（新列进入全量清单但不进默认可见列）
    for (const category of CATEGORIES) {
      expect(DEFAULT_VISIBLE_COLUMN_KEYS[category]).not.toContain('scrape_port')
    }
  })

  it('各类列 meta 数量为 T01-P5 后的新基线（15/15/15/16/18，含操作列）', () => {
    expect(RESOURCE_COLUMN_META.host).toHaveLength(15)
    expect(RESOURCE_COLUMN_META.database).toHaveLength(15)
    expect(RESOURCE_COLUMN_META.middleware).toHaveLength(15)
    expect(RESOURCE_COLUMN_META.application).toHaveLength(16)
    expect(RESOURCE_COLUMN_META.generic_target).toHaveLength(18)
  })

  it('orderColumnKeys：勾选 scrape_port 后按列序归一并保留固定列', () => {
    const keys = orderColumnKeys('host', ['scrape_port', 'actions', 'name'])
    expect(keys).toEqual(['name', 'scrape_port', 'actions'])
    // 未勾选时不并入（默认集外的列按需显隐）
    expect(orderColumnKeys('host', DEFAULT_VISIBLE_COLUMN_KEYS.host)).not.toContain('scrape_port')
  })
})
