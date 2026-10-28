import { apiClient } from './client'
import type { ApiResponse } from '../types/api'

export interface BlackboxModule {
  id: number
  name: string
  content: string
  enabled: boolean
  prober: string
  referenced_jobs: number
  created_at: string
  updated_at: string
}

interface BlackboxModuleListData {
  list: BlackboxModule[]
  total: number
  page: number
  page_size: number
}

export interface BlackboxModuleInput {
  content: string
  enabled: boolean
}

export const blackboxModuleApi = {
  list(): Promise<ApiResponse<BlackboxModuleListData>> {
    return apiClient.get<BlackboxModuleListData>('/api/v2/platform/blackbox-modules', {
      params: { page: 1, page_size: 100 },
    })
  },
  create(name: string, content: string): Promise<ApiResponse<BlackboxModule>> {
    return apiClient.post<BlackboxModule>('/api/v2/platform/blackbox-modules', {
      body: { name, content },
    })
  },
  update(id: number, input: BlackboxModuleInput): Promise<ApiResponse<BlackboxModule>> {
    return apiClient.put<BlackboxModule>(`/api/v2/platform/blackbox-modules/${id}`, { body: input })
  },
  remove(id: number): Promise<ApiResponse<{ deleted: boolean }>> {
    return apiClient.delete<{ deleted: boolean }>(`/api/v2/platform/blackbox-modules/${id}`)
  },
}
