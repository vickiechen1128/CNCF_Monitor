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

/**
 * 标签模板（以 resource_category 锚定，v3 契约 api-contract-snapshot-v3 §4.1）。
 * v3 模板 ID 为 string，mappings 内嵌在模板对象中；无 description / deleted_at 字段。
 */
export interface LabelTemplate {
  id: string
  name: string
  resource_category: ResourceCategory
  is_default: boolean
  mappings: Mapping[]
  created_at: string
  updated_at: string
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
 * 新增/编辑映射输入（v3 §4.1：映射内嵌于模板，随整模板 PUT 提交，无独立 mapping 端点）。
 * 字段与后端 `domain.LabelMapping` 对齐：`source_field` 必填，`transform` 留空 = 原样透传（§5.11）。
 */
export interface MappingInput {
  target_label: string
  source_type: LabelSourceType
  source_field: string
  transform?: string
  enabled?: boolean
}

/** 创建标签模板输入（v3 POST /label-templates；mappings 可空） */
export interface LabelTemplateCreateInput {
  name: string
  resource_category: ResourceCategory
  is_default?: boolean
  mappings?: MappingInput[]
}

/**
 * 更新标签模板输入（v3 PUT /label-templates/:id，全量替换）。
 * `resource_category` 创建后不可变（传了会 400），故类型上不暴露；
 * 注意后端按请求体重建 mappings：调用方要么显式传 mappings，要么用 API 层的整模板写入方法。
 */
export interface LabelTemplateUpdateInput {
  name?: string
  is_default?: boolean
  mappings?: MappingInput[]
}

/**
 * 模板列表项：v3 列表与详情返回同一对象投影（无关联实例数等附加字段）。
 * 保留独立导出名，避免调用方（列表 / 预览 / 采集 Job 表单）大范围改导入。
 */
export type LabelTemplateListItem = LabelTemplate