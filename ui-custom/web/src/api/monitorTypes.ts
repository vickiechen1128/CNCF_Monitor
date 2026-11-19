/**
 * M01 监控对象类型 API（/api/v3/platform/monitor-types，SRS Module_01 v1.3 §5.6）。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { MonitorType, MonitorTypeImpact, MonitorTypeInput, ScopeField } from '../types/monitorType'

export const monitorTypeApi = {
  list(resourceCategory?: string): Promise<ApiResponse<{ list: MonitorType[]; total: number }>> {
    return apiClient.get<{ list: MonitorType[]; total: number }>('/api/v3/platform/monitor-types', {
      params: resourceCategory ? { resource_category: resourceCategory } : undefined,
    })
  },

  get(code: string): Promise<ApiResponse<MonitorType>> {
    return apiClient.get<MonitorType>(`/api/v3/platform/monitor-types/${code}`)
  },

  create(input: MonitorTypeInput): Promise<ApiResponse<MonitorType>> {
    return apiClient.post<MonitorType>('/api/v3/platform/monitor-types', { body: input })
  },

  update(code: string, input: MonitorTypeInput): Promise<ApiResponse<MonitorType>> {
    return apiClient.put<MonitorType>(`/api/v3/platform/monitor-types/${code}`, { body: input })
  },

  remove(code: string): Promise<ApiResponse<{ code: string; deleted: boolean }>> {
    return apiClient.delete<{ code: string; deleted: boolean }>(`/api/v3/platform/monitor-types/${code}`)
  },

  impact(code: string): Promise<ApiResponse<MonitorTypeImpact>> {
    return apiClient.get<MonitorTypeImpact>(`/api/v3/platform/monitor-types/${code}/impact`)
  },

  scopeFields(): Promise<ApiResponse<{ list: ScopeField[]; total: number }>> {
    return apiClient.get<{ list: ScopeField[]; total: number }>('/api/v3/platform/monitor-types/scope-fields')
  },
}
