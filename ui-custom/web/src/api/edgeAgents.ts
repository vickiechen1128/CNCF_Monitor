/**
 * 边缘采集节点 API（M11 契约 §1，采集节点状态页消费）。
 * 权威契约：docs/05-execution-records/module-11/api-contract-snapshot.md §1。
 *
 * GET /api/v2/platform/edge-agents 支持五维筛选查询参数；
 * 注意：当前后端 handler（ListAgentsHandler）尚不消费这些参数（恒返回全量），
 * 前端在本文件透传参数（契约合规），实际筛选在 useEdgeAgents 做客户端过滤兜底。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type { AgentOverall, AgentStatus, ConfigSyncStatus, EdgeAgentsResponse, EdgeComponentStatus } from '../types/edge'

/** 五维筛选查询参数（snake_case；空串 / undefined 由 request 剔除） */
export interface EdgeAgentsListParams extends Record<string, string | undefined> {
  network_domain_id?: string
  /** 整体状态（节点存活视角；对齐 AgentStatus） */
  overall?: AgentStatus | AgentOverall | ''
  /** 采集器组件状态 */
  collector_status?: EdgeComponentStatus | ''
  /** 拨测器组件状态 */
  blackbox_status?: EdgeComponentStatus | ''
  /** 配置同步状态 */
  config_sync_status?: ConfigSyncStatus | ''
}

/** 边缘采集节点（列表返回平铺 DTO，含 summary 聚合） */
export const edgeAgentsApi = {
  list(params?: EdgeAgentsListParams): Promise<ApiResponse<EdgeAgentsResponse>> {
    return apiClient.get<EdgeAgentsResponse>('/api/v2/platform/edge-agents', { params })
  },
}