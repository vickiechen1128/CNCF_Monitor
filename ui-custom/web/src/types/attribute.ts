/**
 * CI 模型与自定义字段类型（SRS Module_07 v2.2 §5.8 FR-30~FR-34）。
 *
 * 内置字段由平台定义、只读；自定义字段由用户登记，状态分「在模型中 / 已移出」，
 * 不设停用/启用开关。
 */
import type { ResourceCategory } from './resource'

export type AttributeValueType = 'boolean' | 'number' | 'text' | 'enum'

/** 自定义字段生命周期：active = 在模型中；removed = 已移出（值保留、表单不渲染）。 */
export type AttributeStatus = 'active' | 'removed'

/** 字段展示分组（固定枚举，不接受自由输入）。 */
export type AttributeGroup = 'identity' | 'ownership' | 'runtime' | 'collection' | 'capability' | 'profile'

/** 内置字段值类型（含日期）。 */
export type BuiltinFieldValueType = 'text' | 'number' | 'boolean' | 'datetime' | 'enum'

export interface AttributeDefinition {
  id: string
  attribute_key: string
  display_name: string
  value_type: AttributeValueType
  resource_category: ResourceCategory
  enum_options?: string[]
  required: boolean
  status: AttributeStatus
  /** 兼容旧字段：等价于 status === 'active'。 */
  enabled: boolean
  display_group: AttributeGroup
  display_group_label: string
  display_order: number
  description?: string
  created_at?: string
  updated_at?: string
}

export interface AttributeDefinitionInput {
  attribute_key: string
  display_name: string
  value_type: AttributeValueType
  resource_category: ResourceCategory
  enum_options?: string[]
  required?: boolean
  display_group?: AttributeGroup
  display_order?: number
  description?: string
}

/** 平台内置字段：不可增删改，页面只读展示。 */
export interface BuiltinField {
  key: string
  label: string
  display_group: AttributeGroup
  display_group_label: string
  display_order: number
  value_type: BuiltinFieldValueType
  required: boolean
  immutable: boolean
}

export interface AttributeGroupOption {
  value: AttributeGroup
  label: string
}

/** 一类 CI 的字段模型。 */
export interface CIModel {
  resource_category: ResourceCategory
  category_label: string
  builtin_fields: BuiltinField[]
  custom_fields: AttributeDefinition[]
  available_groups: AttributeGroupOption[]
}

/** 移除结果：deleted = 删除定义；removed = 移出模型、值保留。 */
export interface RemoveDefinitionResult {
  id: string
  mode: 'deleted' | 'removed'
  usage_count: number
}

export interface ResourceAttributeValue {
  key: string
  value: string
}

/** 值类型中文名（仅界面展示） */
export const ATTRIBUTE_TYPE_LABEL: Record<AttributeValueType, string> = {
  boolean: '布尔',
  number: '数值',
  text: '文本',
  enum: '枚举',
}

/** 字段状态中文名（仅界面展示） */
export const ATTRIBUTE_STATUS_LABEL: Record<AttributeStatus, string> = {
  active: '在模型中',
  removed: '已移出',
}
