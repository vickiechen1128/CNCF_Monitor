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

/**
 * 新增/编辑映射输入（PRD §6.6.3 POST/PUT mappings）。
 * `source_type` 与 `LabelSourceType` 同源（resource_field / composite / prometheus_builtin / cmdb_field）；
 * `transform_rule` 可空，留空 = 原样透传（§5.11）。
 */
export interface MappingInput {
  target_label: string
  source_type: LabelSourceType
  source_field?: string
  transform_rule?: string
}

/** 创建标签模板输入（非默认，is_default=false）；mappings 可空（PRD §6.6.3） */
export interface LabelTemplateCreateInput {
  name: string
  resource_category: ResourceCategory
  description?: string
  mappings?: MappingInput[]
}

/** 更新标签模板输入：仅 name/description 可改；resource_category 创建后不可改，故 update 不含（PRD §6.3/§6.6.3） */
export interface LabelTemplateUpdateInput {
  name?: string
  description?: string
}

/** 关联实例行（§3.2 关联实例展示；GET /label-templates/:template_id/resources 的 item） */
export interface TemplateInstanceItem {
  resource_id: string
  instance_name: string
  status: string
}

/** 模板列表项：LabelTemplate + 关联实例数（§3.2「关联实例 N 个」= 该 resource_category 下资源数） */
export interface LabelTemplateListItem extends LabelTemplate {
  instance_count: number
}