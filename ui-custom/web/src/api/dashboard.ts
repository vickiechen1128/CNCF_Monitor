/**
 * Phase 5 首页 Dashboard 聚合概览 API 客户端。
 * 权威契约：GET /api/v2/platform/dashboard/summary
 * 返回统一 `ApiResponse<DashboardSummary>`，聚合 M06/M07/M01/M09 概览数据。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'

/** 最近下发记录项（M09 deployment 精简字段） */
export interface RecentDeployment {
  id: string
  change_no: string
  network_domain_name: string
  status: string
  triggered_at: string
}

/** Dashboard 聚合概览 */
export interface DashboardSummary {
  resource_count: number
  pending_draft_count: number
  recent_deployments: RecentDeployment[]
  domain_count: number
}

export const dashboardApi = {
  getSummary(): Promise<ApiResponse<DashboardSummary>> {
    return apiClient.get<DashboardSummary>('/api/v2/platform/dashboard/summary')
  },
}