/**
 * 监控对象类型（SRS Module_01 v1.3 §5.6 FR-21~FR-24）。
 *
 * 类型是平台可配置元数据：一条定义 + 若干条推导规则，新增类型不需要改代码。
 */
import type { ResourceCategory } from './resource'

/** 推导规则操作符（与后端 domain.RuleOperator 对齐） */
export type MonitorTypeOperator = 'eq' | 'contains' | 'contains_any' | 'in' | 'always' | 'regexp'

/** 同一类型内多条规则的组合方式 */
export type MonitorTypeRuleLogic = 'all' | 'any'

/** 推导字段类型：text 文本 / boolean 布尔能力 / os_family 操作系统家族（虚拟字段） */
export type ScopeFieldKind = 'text' | 'boolean' | 'os_family'

export interface MonitorTypeRule {
  id?: string
  field: string
  operator: MonitorTypeOperator
  values?: string[]
  priority?: number
}

export interface MonitorType {
  code: string
  name: string
  resource_category: ResourceCategory
  rule_logic: MonitorTypeRuleLogic
  description?: string
  icon?: string
  color?: string
  sort_order: number
  enabled: boolean
  is_builtin: boolean
  rules: MonitorTypeRule[]
  created_at?: string
  updated_at?: string
}

export interface MonitorTypeInput {
  code?: string
  name: string
  resource_category: ResourceCategory
  rule_logic?: MonitorTypeRuleLogic
  description?: string
  sort_order?: number
  enabled?: boolean
  rules: MonitorTypeRule[]
}

/** 规则可选字段（服务端白名单，前端不硬编码物理列名） */
export interface ScopeField {
  key: string
  label: string
  kind: ScopeFieldKind
  categories: ResourceCategory[]
}

export interface MonitorTypeReferences {
  mappings: number
  jobs: number
  rules: number
  metric_anchors: number
}

export interface MonitorTypeImpact {
  code: string
  references: MonitorTypeReferences
  rule_count: number
  matched_resources: number
}

/** 操作符中文名（仅界面展示） */
export const OPERATOR_LABEL: Record<MonitorTypeOperator, string> = {
  eq: '等于',
  contains: '包含',
  contains_any: '包含任一',
  in: '属于集合',
  always: '恒真（该类别全部）',
  regexp: '正则匹配',
}

/** 组合方式中文名 */
export const RULE_LOGIC_LABEL: Record<MonitorTypeRuleLogic, string> = {
  all: '全部满足（AND）',
  any: '满足任一（OR）',
}
