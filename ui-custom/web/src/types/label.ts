/**
 * 标签领域类型：LabelTemplate / Mapping / ResourceLabel
 *
 * 与 Module_07 §5.10~§5.12 对齐。LabelTemplate 以 resource_category 锚定，
 * Mapping 定义 source_field → target_label 的映射规则。
 */
import type { ResourceCategory } from './resource'

/** 映射来源类型 */
export type LabelSourceType = 'resource_field' | 'composite' | 'prometheus_builtin' | 'cmdb_field'

/** 单条 source → Prometheus label 映射 */
export interface Mapping {
  source_field: string
  source_type: LabelSourceType
  target_label: string
  enabled: boolean
  transform?: string
}

/** 标签模板（以 resource_category 锚定） */
export interface LabelTemplate {
  id: number
  name: string
  resource_category: ResourceCategory
  is_default: boolean
  mappings: Mapping[]
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** 资源标签来源 */
export type LabelSource = 'system' | 'user' | 'cmdb'

/** 资源标签（key/value） */
export interface ResourceLabel {
  id: number
  resource_id: string
  key: string
  value: string
  source: LabelSource
  created_at: string
  updated_at: string
  deleted_at?: string
}