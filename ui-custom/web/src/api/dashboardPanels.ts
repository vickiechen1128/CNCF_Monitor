import { apiClient } from './client'
import type { ApiResponse } from '../types/api'

export interface DashboardPanel {
  id: number
  name: string
  url: string
  created_at?: string
  updated_at?: string
}

export interface DashboardPanelList {
  list: DashboardPanel[]
  total: number
  page: number
  page_size: number
}

export interface DashboardPanelCreateInput {
  name: string
  url: string
}

export const dashboardPanelApi = {
  list(): Promise<ApiResponse<DashboardPanelList>> {
    return apiClient.get<DashboardPanelList>('/api/v2/platform/dashboard/panels', {
      params: { page: 1, page_size: 100 },
    })
  },
  get(id: string): Promise<ApiResponse<DashboardPanel>> {
    return apiClient.get<DashboardPanel>(`/api/v2/platform/dashboard/panels/${id}`)
  },
  create(input: DashboardPanelCreateInput): Promise<ApiResponse<DashboardPanel>> {
    return apiClient.post<DashboardPanel>('/api/v2/platform/dashboard/panels', { body: input })
  },
}
