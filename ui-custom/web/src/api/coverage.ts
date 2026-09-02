/**
 * 采集健康度 / 覆盖率 API（Module_02 决策 47-3，/api/v1，api-contract-snapshot.md §2.2）
 *
 * coverageApi.list：GET /api/v1/health/coverage 三态聚合（collecting / pending_down /
 * not_monitored），按 resource_id 稳定标签回连五类资源。M02 后端一次拉取全量，
 * 前端按 resource_id 与资源列表行合并渲染，禁止逐行查询（TQ-6 N+1）。
 * 被 module-07（资源列表三态 badge，决策 47-3）只读消费。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { CoverageListResponse, CoverageState } from '../types/query'

/** GET /api/v1/health/coverage 筛选参数（§2.2，MVP 恒 network_domain=default；page_size 默认 1/500 上限 1000） */
export interface CoverageListParams extends Record<string, string | number | boolean | undefined> {
  /** 按网域过滤（MVP 恒 default） */
  network_domain?: string
  /** 过滤五类资源 */
  resource_category?: string
  /** 按 collecting / pending_down / not_monitored 过滤 */
  state?: CoverageState
  page?: number
  page_size?: number
}

/** 采集健康度 / 覆盖率（资源列表 badge 数据源，§2.2） */
export const coverageApi = {
  list(params?: CoverageListParams): Promise<ApiResponse<CoverageListResponse>> {
    return apiClient.get<CoverageListResponse>('/api/v1/health/coverage', { params })
  },
}