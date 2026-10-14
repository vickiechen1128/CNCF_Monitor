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
import type { AgentView, EdgeAgentsResponse } from '../types/edge'

/** 边缘采集节点（列表返回平铺 DTO，含 summary 聚合） */
export const edgeAgentsApi = {
  list(): Promise<ApiResponse<EdgeAgentsResponse>> {
    return apiClient.get<EdgeAgentsResponse>('/api/v2/platform/edge-agents')
  },
  /**
   * 人工重启采集进程（F-42）：递增该节点 vm_agent_restart_seq 并留痕，节点约 30s 内
   * 随下次心跳执行幂等滚动重启（仅重启 vmagent 采集子进程，agent 本体与持久队列不受
   * 影响，队列数据不丢）。需 admin 权限；节点离线/退役时后端返回 400。
   */
  restart(id: number): Promise<ApiResponse<AgentView>> {
    return apiClient.put<AgentView>(`/api/v2/platform/edge-agents/${id}/restart`, {})
  },
  /**
   * 清空回传积压（F-43，破坏性操作）：递增该节点 flush_backlog_seq 并留痕，节点随
   * 下次心跳执行「停 vmagent → 删其持久队列目录（积压数据永久丢弃）→ 重新拉起」，
   * 换取回传通道实时性恢复——适用于积压排空时间远超时效容忍的止血场景。需 admin
   * 权限；节点离线/退役时后端返回 400（破坏性操作仅限在线节点）。
   */
  flushBacklog(id: number): Promise<ApiResponse<AgentView>> {
    return apiClient.put<AgentView>(`/api/v2/platform/edge-agents/${id}/flush-backlog`, {})
  },
}