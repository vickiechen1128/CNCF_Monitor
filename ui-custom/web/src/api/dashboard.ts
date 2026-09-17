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

/**
 * Dashboard 聚合概览。
 * 决策 72-3（M05 首页内容重构，design-proposals/homepage-mvp-content-restructure.md §4.2）
 * 新增 monitored_count / scrape_job_count / scrape_job_enabled_count 三个计数字段。
 */
export interface DashboardSummary {
  /** 监控资源总数（M07 五类资源表合计） */
  resource_count: number
  /** 已监控资源数：被至少一个已启用（ready + enabled）采集任务覆盖到的资源数（去重） */
  monitored_count: number
  /** 采集任务总数（未软删） */
  scrape_job_count: number
  /** 采集任务中 enabled=true 的数量 */
  scrape_job_enabled_count: number
  /** 待确认配置草稿数（M09，status=pending） */
  pending_draft_count: number
  /** 最近下发记录（最多 5 条） */
  recent_deployments: RecentDeployment[]
  /** 已纳管网域数（is_monitored=true） */
  domain_count: number
}

export const dashboardApi = {
  getSummary(): Promise<ApiResponse<DashboardSummary>> {
    return apiClient.get<DashboardSummary>('/api/v2/platform/dashboard/summary')
  },
}