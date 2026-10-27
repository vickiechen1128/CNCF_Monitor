import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { InhibitionListData, SaveInhibitionsPayload, SaveRoutesResult } from '../types/alertmanager'

export const inhibitionsApi = {
  list(): Promise<ApiResponse<InhibitionListData>> {
    return apiClient.get<InhibitionListData>('/api/v2/platform/alertmanager/inhibitions')
  },
  save(payload: SaveInhibitionsPayload): Promise<ApiResponse<SaveRoutesResult>> {
    return apiClient.post<SaveRoutesResult>('/api/v2/platform/alertmanager/inhibitions', { body: payload })
  },
}
