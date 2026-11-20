/**
 * 采集模板 + 选择器字段字典 API（/api/v3/platform，SRS Module_01 v1.5）。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type {
  CandidateField,
  CollectionTemplate,
  CollectionTemplateImpact,
  CollectionTemplateInput,
} from '../types/collectionTemplate'

export interface CollectionTemplateListParams extends Record<string, string | number | boolean | undefined> {
  resource_category?: string
  enabled?: boolean
  keyword?: string
  page?: number
  page_size?: number
}

export const collectionTemplateApi = {
  list(params?: CollectionTemplateListParams): Promise<ApiResponse<Paginated<CollectionTemplate>>> {
    return apiClient.get<Paginated<CollectionTemplate>>('/api/v3/platform/collection-templates', { params })
  },

  get(code: string): Promise<ApiResponse<CollectionTemplate>> {
    return apiClient.get<CollectionTemplate>(`/api/v3/platform/collection-templates/${code}`)
  },

  create(input: CollectionTemplateInput): Promise<ApiResponse<CollectionTemplate>> {
    return apiClient.post<CollectionTemplate>('/api/v3/platform/collection-templates', { body: input })
  },

  update(code: string, input: CollectionTemplateInput): Promise<ApiResponse<CollectionTemplate>> {
    return apiClient.put<CollectionTemplate>(`/api/v3/platform/collection-templates/${code}`, { body: input })
  },

  remove(code: string): Promise<ApiResponse<{ code: string }>> {
    return apiClient.delete<{ code: string }>(`/api/v3/platform/collection-templates/${code}`)
  },

  impact(code: string): Promise<ApiResponse<CollectionTemplateImpact>> {
    return apiClient.get<CollectionTemplateImpact>(`/api/v3/platform/collection-templates/${code}/impact`)
  },
}

export const candidateFieldApi = {
  list(): Promise<ApiResponse<{ list: CandidateField[]; total: number }>> {
    return apiClient.get<{ list: CandidateField[]; total: number }>('/api/v3/platform/candidate-fields')
  },
}
