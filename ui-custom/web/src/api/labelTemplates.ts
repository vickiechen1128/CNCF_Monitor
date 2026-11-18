/**
 * 标签模板平台 API（/api/v3/platform/label-templates/...）
 *
 * 对齐 v3 契约（docs/05-execution-records/rewrite/v2.0/modules/module-07/
 * api-contract-snapshot-v3.md §4.1）：
 * - 模板 ID 为 string；列表信封 `{list,total,page,page_size}`；
 * - 模板对象无 description / deleted_at，`mappings` 内嵌在模板里；
 * - v3 没有 mapping 子端点 / clone 端点 / 关联实例端点：
 *   映射增删改一律「GET 模板 → 改 mappings 数组 → PUT 整模板」（映射无 id，用下标定位）；
 *   clone 由「GET 原模板 → POST 新模板」实现；
 *   v3 模板由 M01 Job / 默认映射引用、不绑定资源实例，故不再提供 `resources` 方法。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type {
  LabelTemplate,
  LabelTemplateCreateInput,
  LabelTemplateListItem,
  LabelTemplateUpdateInput,
  Mapping,
  MappingInput,
} from '../types/label'

/** v3 标签模板资源根路径 */
const BASE_PATH = '/api/v3/platform/label-templates'

/** 模板列表查询参数（v3 §4.1：resource_category / is_default / keyword / page / page_size） */
export interface LabelTemplateListParams extends Record<string, string | number | boolean | undefined> {
  resource_category?: string
  is_default?: boolean
  keyword?: string
  page?: number
  page_size?: number
}

/** 模板详情路径 */
function templatePath(templateId: string): string {
  return `${BASE_PATH}/${encodeURIComponent(templateId)}`
}

/**
 * 映射输入 → v3 请求体中的映射对象。
 * 显式补齐 `transform` / `enabled`，避免未选转换规则时字段缺失。
 */
function toMappingPayload(input: MappingInput): Mapping {
  return {
    source_field: input.source_field,
    source_type: input.source_type,
    target_label: input.target_label,
    enabled: input.enabled ?? true,
    transform: input.transform ?? '',
  }
}

/**
 * 以「整模板 PUT」写回映射（v3 无 mapping 子端点）。
 * `resource_category` 不可变且传了会 400，故请求体只带 name / is_default / mappings。
 * 返回更新后的映射数组，保持调用方（MappingDrawer 等）既有签名。
 */
async function writeMappings(template: LabelTemplate, mappings: Mapping[]): Promise<ApiResponse<Mapping[]>> {
  const payload = mappings.map(toMappingPayload)
  const res = await apiClient.put<LabelTemplate>(templatePath(template.id), {
    body: {
      name: template.name,
      is_default: template.is_default,
      mappings: payload,
    },
  })
  return { ...res, data: res.data?.mappings ?? payload }
}

/** 读取模板（映射增删改的前置步骤：v3 只能整模板替换） */
async function loadTemplate(templateId: string): Promise<LabelTemplate> {
  const res = await apiClient.get<LabelTemplate>(templatePath(templateId))
  return res.data
}

/** 映射下标越界时的可读错误（模板可能已被他人改过，提示刷新） */
function mappingIndexOutOfRange(index: number): Error {
  return new Error(`映射下标 ${index} 越界：模板映射可能已被修改，请刷新后重试`)
}

/** 标签模板管理 */
export const labelTemplateApi = {
  list(params?: LabelTemplateListParams): Promise<ApiResponse<Paginated<LabelTemplateListItem>>> {
    return apiClient.get<Paginated<LabelTemplateListItem>>(BASE_PATH, { params })
  },
  get(templateId: string): Promise<ApiResponse<LabelTemplate>> {
    return apiClient.get<LabelTemplate>(templatePath(templateId))
  },
  create(input: LabelTemplateCreateInput): Promise<ApiResponse<LabelTemplate>> {
    return apiClient.post<LabelTemplate>(BASE_PATH, { body: input })
  },
  /**
   * 全量更新（v3 PUT）。后端按请求体重建模板：未传 mappings 会清空映射，
   * 仅改名称/默认标记时请先 get 再带上原有 mappings（或使用映射专用方法）。
   */
  update(templateId: string, input: LabelTemplateUpdateInput): Promise<ApiResponse<LabelTemplate>> {
    const body: Record<string, unknown> = {}
    if (input.name !== undefined) body.name = input.name
    if (input.is_default !== undefined) body.is_default = input.is_default
    if (input.mappings !== undefined) body.mappings = input.mappings.map(toMappingPayload)
    // 不提交 resource_category：v3 创建后不可变，PUT 携带会返回 400
    return apiClient.put<LabelTemplate>(templatePath(templateId), { body })
  },
  /**
   * 设为该资源类别的默认模板（v2.56）。
   * v3 PUT 是全量替换：必须先 GET 原模板，再带 `name` + 完整 `mappings` 提交
   * `is_default=true`；只传 `is_default` 会因 name 为空 / mappings 被清空而失败。
   * 后端同一类别默认互斥，旧默认自动取消。
   */
  async setDefault(templateId: string): Promise<ApiResponse<LabelTemplate>> {
    const source = await loadTemplate(templateId)
    return apiClient.put<LabelTemplate>(templatePath(templateId), {
      body: {
        name: source.name,
        is_default: true,
        mappings: source.mappings.map(toMappingPayload),
      },
    })
  },
  remove(templateId: string): Promise<ApiResponse<{ id: string }>> {
    // 被 M01 映射 / Job 引用时后端返回 409，错误由调用方透出（不吞错）
    return apiClient.delete<{ id: string }>(templatePath(templateId))
  },
  /**
   * 克隆模板：v3 无 clone 端点，由「GET 原模板 → POST 新模板」实现。
   * 新模板名称默认 `${原名} 副本`，可通过 name 覆盖；新模板恒为非默认（is_default=false）。
   */
  async clone(templateId: string, input?: { name?: string }): Promise<ApiResponse<LabelTemplate>> {
    const source = await loadTemplate(templateId)
    const name = input?.name?.trim() || `${source.name} 副本`
    return apiClient.post<LabelTemplate>(BASE_PATH, {
      body: {
        name,
        resource_category: source.resource_category,
        is_default: false,
        mappings: source.mappings.map(toMappingPayload),
      },
    })
  },
  /** 追加一条映射（GET 模板 → 追加 → PUT 整模板） */
  async addMapping(templateId: string, input: MappingInput): Promise<ApiResponse<Mapping[]>> {
    const template = await loadTemplate(templateId)
    return writeMappings(template, [...template.mappings, toMappingPayload(input)])
  },
  /** 整组替换映射（GET 模板 → 替换 mappings → PUT 整模板） */
  async replaceMappings(templateId: string, mappings: MappingInput[]): Promise<ApiResponse<Mapping[]>> {
    const template = await loadTemplate(templateId)
    return writeMappings(template, mappings.map(toMappingPayload))
  },
  /** 按下标更新一条映射（v3 映射无 id） */
  async updateMapping(
    templateId: string,
    mappingIndex: number,
    input: Partial<MappingInput>,
  ): Promise<ApiResponse<Mapping[]>> {
    const template = await loadTemplate(templateId)
    if (mappingIndex < 0 || mappingIndex >= template.mappings.length) {
      throw mappingIndexOutOfRange(mappingIndex)
    }
    const mappings = template.mappings.map((mapping, index) =>
      index === mappingIndex ? toMappingPayload({ ...mapping, ...input }) : toMappingPayload(mapping),
    )
    return writeMappings(template, mappings)
  },
  /** 按下标删除一条映射（v3 映射无 id） */
  async removeMapping(templateId: string, mappingIndex: number): Promise<ApiResponse<Mapping[]>> {
    const template = await loadTemplate(templateId)
    if (mappingIndex < 0 || mappingIndex >= template.mappings.length) {
      throw mappingIndexOutOfRange(mappingIndex)
    }
    return writeMappings(
      template,
      template.mappings.filter((_, index) => index !== mappingIndex),
    )
  },
}
