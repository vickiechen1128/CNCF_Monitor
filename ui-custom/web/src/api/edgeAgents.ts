/**
 * 边缘采集节点 API（M11 契约 §1，采集节点状态页消费）。
 * 权威契约：docs/05-execution-records/module-11/api-contract-snapshot.md §1。
 *
 * GET /api/v2/platform/edge-agents：当前后端 handler（ListAgentsHandler）恒返回全量，
 * 不消费筛选 query。故本 API 保持无参拉取，五维筛选交由 useEdgeAgents 做客户端过滤兜底
 * （契约 §1 预留的筛选 query 在后端服务端筛选落地于 v0.3 后再按需补回）。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { EdgeAgentsResponse } from '../types/edge'

/** 边缘采集节点（列表返回平铺 DTO，含 summary 聚合） */
export const edgeAgentsApi = {
  list(): Promise<ApiResponse<EdgeAgentsResponse>> {
    return apiClient.get<EdgeAgentsResponse>('/api/v2/platform/edge-agents')
  },
}