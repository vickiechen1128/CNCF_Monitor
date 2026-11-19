/**
 * 资源能力属性（SRS Module_07 v2.1 §5.8 FR-31）。
 *
 * 固定能力字段（has_npu / has_gpu）走资源 attributes；长尾能力经扩展属性字典
 * 登记 key 后按资源存值，新增 key 不需要改表或发版。
 */
import type { ResourceCategory } from './resource'

export type AttributeValueType = 'boolean' | 'number' | 'text' | 'enum'

export interface AttributeDefinition {
  id: string
  attribute_key: string
  display_name: string
  value_type: AttributeValueType
  resource_category: ResourceCategory
  enum_options?: string[]
  required: boolean
  enabled: boolean
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
  enabled?: boolean
  description?: string
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
