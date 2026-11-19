/**
 * 资源能力属性 API —— 扩展属性字典 + 资源属性值
 *（SRS Module_07 v2.1 §5.8 FR-31，/api/v3/platform/attribute-definitions、
 *  /api/v3/platform/resources/:resource_id/attributes）。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  AttributeDefinition,
  AttributeDefinitionInput,
  ResourceAttributeValue,
} from '../types/attribute'

export const attributeDefinitionApi = {
  list(resourceCategory?: string): Promise<ApiResponse<{ list: AttributeDefinition[]; total: number }>> {
    return apiClient.get<{ list: AttributeDefinition[]; total: number }>(
      '/api/v3/platform/attribute-definitions',
      { params: resourceCategory ? { resource_category: resourceCategory } : undefined },
    )
  },

  create(input: AttributeDefinitionInput): Promise<ApiResponse<AttributeDefinition>> {
    return apiClient.post<AttributeDefinition>('/api/v3/platform/attribute-definitions', { body: input })
  },

  update(id: string, input: AttributeDefinitionInput): Promise<ApiResponse<AttributeDefinition>> {
    return apiClient.put<AttributeDefinition>(`/api/v3/platform/attribute-definitions/${id}`, { body: input })
  },

  remove(id: string): Promise<ApiResponse<{ id: string; deleted: boolean }>> {
    return apiClient.delete<{ id: string; deleted: boolean }>(`/api/v3/platform/attribute-definitions/${id}`)
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
