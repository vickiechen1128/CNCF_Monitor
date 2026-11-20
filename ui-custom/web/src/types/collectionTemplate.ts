/**
 * 采集模板与任务选择器（SRS Module_01 v1.5 §3.1 / §5.6）。
 *
 * 模板回答「这类对象怎么采」（一个采集实现 + 一套参数 + 一个标签模板），
 * 不携带适用范围；「采哪些对象」由任务自己的 selector 表达。
 */
import type { ResourceCategory } from './resource'

/** 选择器操作符（与后端 domain.RuleOperator 对齐） */
export type SelectorOperator = 'eq' | 'contains' | 'contains_any' | 'in' | 'always' | 'regexp'

/** 条件组合方式 */
export type SelectorLogic = 'all' | 'any'

/** 选择器字段类型：text 文本 / boolean 布尔 / os_family 操作系统家族 / enum 枚举 */
export type CandidateFieldKind = 'text' | 'boolean' | 'os_family' | 'enum'

export interface SelectorFilter {
  field: string
  operator: SelectorOperator
  values?: string[]
}

export interface Selector {
  logic: SelectorLogic
  filters: SelectorFilter[]
}

/** 选择器字段字典项（内置字段来自 M01，custom=true 来自 M07 自定义字段） */
export interface CandidateField {
  key: string
  label: string
  kind: CandidateFieldKind
  categories: ResourceCategory[]
  custom: boolean
}

export interface CollectionTemplate {
  code: string
  name: string
  resource_category: ResourceCategory
  exporter_template_id: string
  exporter_template_name?: string
  default_port: number
  metrics_path: string
  scheme: string
  scrape_interval: string
  scrape_timeout: string
  label_template_id: string
  label_template_name?: string
  default_selector: Selector
  description?: string
  sort_order: number
  enabled: boolean
  is_builtin: boolean
  reference_job_count: number
  created_at?: string
  updated_at?: string
}

export interface CollectionTemplateInput {
  code?: string
  name: string
  resource_category: ResourceCategory
  exporter_template_id: string
  default_port?: number
  metrics_path?: string
  scheme?: string
  scrape_interval?: string
  scrape_timeout?: string
  label_template_id?: string
  default_selector?: Selector
  description?: string
  sort_order?: number
  enabled?: boolean
}

export interface CollectionTemplateImpact {
  code: string
  reference_jobs: number
  metric_anchors: number
  matched_resources?: number
  updated_at?: string
}

/** 操作符中文名（仅界面展示） */
export const OPERATOR_LABEL: Record<SelectorOperator, string> = {
  eq: '等于',
  contains: '包含',
  contains_any: '包含任一',
  in: '属于集合',
  always: '恒真（不限条件）',
  regexp: '正则匹配',
}

/** 操作符顺序（下拉选项） */
export const OPERATOR_OPTIONS: SelectorOperator[] = ['eq', 'contains', 'contains_any', 'in', 'regexp', 'always']

/** 空选择器：不限条件（等价于该类别全部资源） */
export const EMPTY_SELECTOR: Selector = { logic: 'all', filters: [] }

/** 归一化：丢弃空字段/空值，保证提交给后端的数据干净 */
export function normalizeSelector(selector?: Selector | null): Selector {
  if (!selector) return { ...EMPTY_SELECTOR }
  return {
    logic: selector.logic ?? 'all',
    filters: (selector.filters ?? [])
      .filter((filter) => filter.field)
      .map((filter) => ({
        field: filter.field,
        operator: filter.operator ?? 'eq',
        values: filter.operator === 'always' ? [] : (filter.values ?? []).filter((v) => v.trim() !== ''),
      })),
  }
}
