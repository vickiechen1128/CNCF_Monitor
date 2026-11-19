/**
 * CI 模型与自定义字段 API（SRS Module_07 v2.2 §5.8 FR-30~FR-34）：
 * - /api/v3/platform/ci-models：六类内置字段 + 在模型中的自定义字段；
 * - /api/v3/platform/attribute-definitions：自定义字段增删改查。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  AttributeDefinition,
  AttributeDefinitionInput,
  AttributeStatus,
  CIModel,
  RemoveDefinitionResult,
  ResourceAttributeValue,
} from '../types/attribute'
import type { ResourceCategory } from '../types/resource'

export const ciModelApi = {
  list(): Promise<ApiResponse<{ list: CIModel[] }>> {
    return apiClient.get<{ list: CIModel[] }>('/api/v3/platform/ci-models')
  },

  get(category: ResourceCategory): Promise<ApiResponse<CIModel>> {
    return apiClient.get<CIModel>(`/api/v3/platform/ci-models/${category}`)
  },
}

export const attributeDefinitionApi = {
  list(
    resourceCategory?: string,
    status?: AttributeStatus,
  ): Promise<ApiResponse<{ list: AttributeDefinition[]; total: number }>> {
    const params: Record<string, string> = {}
    if (resourceCategory) params.resource_category = resourceCategory
    if (status) params.status = status
    return apiClient.get<{ list: AttributeDefinition[]; total: number }>(
      '/api/v3/platform/attribute-definitions',
      { params: Object.keys(params).length > 0 ? params : undefined },
    )
  },

  create(input: AttributeDefinitionInput): Promise<ApiResponse<AttributeDefinition>> {
    return apiClient.post<AttributeDefinition>('/api/v3/platform/attribute-definitions', { body: input })
  },

  update(id: string, input: AttributeDefinitionInput): Promise<ApiResponse<AttributeDefinition>> {
    return apiClient.put<AttributeDefinition>(`/api/v3/platform/attribute-definitions/${id}`, { body: input })
  },

  remove(id: string): Promise<ApiResponse<RemoveDefinitionResult>> {
    return apiClient.delete<RemoveDefinitionResult>(`/api/v3/platform/attribute-definitions/${id}`)
  },
}

export const resourceAttributeApi = {
  list(resourceId: string): Promise<ApiResponse<{ list: ResourceAttributeValue[]; total: number }>> {
    return apiClient.get<{ list: ResourceAttributeValue[]; total: number }>(
      `/api/v3/platform/resources/${resourceId}/attributes`,
    )
  },

  replace(
    resourceId: string,
    values: ResourceAttributeValue[],
  ): Promise<ApiResponse<{ list: ResourceAttributeValue[]; total: number }>> {
    return apiClient.put<{ list: ResourceAttributeValue[]; total: number }>(
      `/api/v3/platform/resources/${resourceId}/attributes`,
      { body: { attributes: values } },
    )
  },
}
