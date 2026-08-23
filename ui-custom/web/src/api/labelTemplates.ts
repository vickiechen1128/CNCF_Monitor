/**
 * 标签模板平台 API（/api/v2/platform/label-templates/...）
 *
 * 复用 `apiClient`，按 Module_07 §6.3/§6.6.3 与 03_API_Standard 的
 * `/api/v2/platform/*` 平台能力契约提供类型化调用，返回 `ApiResponse<T>`。
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
  TemplateInstanceItem,
} from '../types/label'

/** 模板列表查询参数（PRD §6.6.3：resource_category / is_default / keyword / page / page_size） */
export interface LabelTemplateListParams extends Record<string, string | number | boolean | undefined> {
  resource_category?: string
  is_default?: boolean
  keyword?: string
  page?: number
  page_size?: number
}

/** 关联实例查询参数（GET :template_id/resources，page/page_size 默认 10，PRD §3.2/§11.1） */
export interface TemplateInstanceListParams extends Record<string, string | number | boolean | undefined> {
  page?: number
  page_size?: number
}

/**
 * 关联实例分页响应（GET :template_id/resources）。
 * 注意：契约返回字段为 `items` 而非标准信封 `list`（PRD §6.6.3 / T07-17），
 * 故不复用 `Paginated<T>`，单独声明以对齐后端契约。
 */
export interface TemplateInstancePage {
  items: TemplateInstanceItem[]
  total: number
  page: number
  page_size: number
}

/** 删除映射响应（PRD §6.6.3：返回 `{ mapping_id }`） */
export interface MappingRemoveResult {
  mapping_id: number
}

/** 标签模板管理 */
export const labelTemplateApi = {
  list(params?: LabelTemplateListParams): Promise<ApiResponse<Paginated<LabelTemplateListItem>>> {
    return apiClient.get<Paginated<LabelTemplateListItem>>('/api/v2/platform/label-templates', { params })
  },
  create(input: LabelTemplateCreateInput): Promise<ApiResponse<LabelTemplate>> {
    return apiClient.post<LabelTemplate>('/api/v2/platform/label-templates', { body: input })
  },
  update(templateId: number, input: LabelTemplateUpdateInput): Promise<ApiResponse<LabelTemplate>> {
    return apiClient.put<LabelTemplate>(`/api/v2/platform/label-templates/${encodeURIComponent(templateId)}`, {
      body: input,
    })
  },
  remove(templateId: number): Promise<ApiResponse<null>> {
    return apiClient.delete<null>(`/api/v2/platform/label-templates/${encodeURIComponent(templateId)}`)
  },
  clone(templateId: number, input?: { name?: string }): Promise<ApiResponse<LabelTemplate>> {
    return apiClient.post<LabelTemplate>(
      `/api/v2/platform/label-templates/${encodeURIComponent(templateId)}/clone`,
      { body: input ?? {} },
    )
  },
  resources(
    templateId: number,
    params?: TemplateInstanceListParams,
  ): Promise<ApiResponse<TemplateInstancePage>> {
    return apiClient.get<TemplateInstancePage>(
      `/api/v2/platform/label-templates/${encodeURIComponent(templateId)}/resources`,
      { params },
    )
  },
  addMapping(templateId: number, input: MappingInput): Promise<ApiResponse<Mapping[]>> {
    return apiClient.post<Mapping[]>(`/api/v2/platform/label-templates/${encodeURIComponent(templateId)}/mappings`, {
      body: input,
    })
  },
  updateMapping(
    templateId: number,
    mappingId: number,
    input: Partial<MappingInput>,
  ): Promise<ApiResponse<Mapping[]>> {
    return apiClient.put<Mapping[]>(
      `/api/v2/platform/label-templates/${encodeURIComponent(templateId)}/mappings/${encodeURIComponent(mappingId)}`,
      { body: input },
    )
  },
  removeMapping(templateId: number, mappingId: number): Promise<ApiResponse<MappingRemoveResult>> {
    return apiClient.delete<MappingRemoveResult>(
      `/api/v2/platform/label-templates/${encodeURIComponent(templateId)}/mappings/${encodeURIComponent(mappingId)}`,
    )
  },
}
