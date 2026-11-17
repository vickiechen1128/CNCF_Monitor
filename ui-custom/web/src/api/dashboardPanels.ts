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

export interface DashboardPanelListParams {
  page?: number
  page_size?: number
}

/** 面板挂载（M05 FR-08）：列表分页默认 20/页，后端上限 100；子菜单需要全量时显式传 100。 */
export const dashboardPanelApi = {
  list(params: DashboardPanelListParams = {}): Promise<ApiResponse<DashboardPanelList>> {
    return apiClient.get<DashboardPanelList>('/api/v3/platform/dashboard/panels', {
      params: { page: 1, page_size: 20, ...params },
    })
  },
  get(id: string): Promise<ApiResponse<DashboardPanel>> {
    return apiClient.get<DashboardPanel>(`/api/v3/platform/dashboard/panels/${id}`)
  },
  create(input: DashboardPanelCreateInput): Promise<ApiResponse<DashboardPanel>> {
    return apiClient.post<DashboardPanel>('/api/v3/platform/dashboard/panels', { body: input })
  },
  update(id: number, input: DashboardPanelCreateInput): Promise<ApiResponse<DashboardPanel>> {
    return apiClient.put<DashboardPanel>(`/api/v3/platform/dashboard/panels/${id}`, { body: input })
  },
}
