/**
 * 边缘采集节点 API（M09 v3 契约 §3）。
 * 权威契约：docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md §3。
 *
 * GET /api/v3/platform/edge-agents 返回分页信封 `{list,total,page,page_size}`；
 * 页面沿用「全量拉取 + 客户端五维筛选」的既有交互，故本适配层：
 * - 默认 page_size=100（契约上限），尽力一次取全；
 * - 把 v3 的 `last_heartbeat_at` 归一为页面字段 `last_heartbeat`；
 * - 由列表派生 overall / summary 聚合档，保持页面组件契约不变。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  AgentOverall,
  AgentStatus,
  AgentView,
  EdgeAgentsResponse,
  EdgeAgentsSummary,
  EdgeComponentStatus,
} from '../types/edge'

const AGENTS_PATH = '/api/v3/platform/edge-agents'

/** GET /edge-agents 筛选参数（契约 §3.2：network_domain_id / status / keyword + 分页） */
export interface EdgeAgentsListParams {
  network_domain_id?: string
  status?: AgentStatus
  keyword?: string
  page?: number
  page_size?: number
}

/** v3 节点视图（与页面 AgentView 的差异：心跳字段名 last_heartbeat_at） */
type AgentResponse = Omit<AgentView, 'last_heartbeat'> & {
  last_heartbeat_at?: string | null
}

interface AgentListResponse {
  list?: AgentResponse[]
  total?: number
  page?: number
  page_size?: number
}

/** 组件异常 → 该节点计入「部分异常」 */
const DEGRADED_COMPONENT_STATUS: EdgeComponentStatus[] = ['restarting', 'crash_loop']

function toAgentView(item: AgentResponse): AgentView {
  const { last_heartbeat_at, ...rest } = item
  return { ...rest, last_heartbeat: last_heartbeat_at ?? undefined }
}

/** 由节点列表派生整体档与三档计数（v3 不再下发 summary） */
function summarize(agents: AgentView[]): { overall: AgentOverall; summary: EdgeAgentsSummary } {
  let online = 0
  let offline = 0
  let partial = 0
  for (const agent of agents) {
    if (agent.status === 'online') {
      online += 1
      if ((agent.components ?? []).some((c) => DEGRADED_COMPONENT_STATUS.includes(c.status))) {
        partial += 1
      }
    } else if (agent.status === 'offline') {
      offline += 1
    }
  }
  const total = agents.length
  let overall: AgentOverall = 'unknown'
  if (total > 0) {
    if (offline === total) overall = 'offline'
    else if (partial > 0) overall = 'partial'
    else overall = 'normal'
  }
  return { overall, summary: { total, online, partial, offline } }
}

/** 边缘采集节点（列表 + 人工指令） */
export const edgeAgentsApi = {
  /** 节点列表；默认拉取前 100 条（契约上限），筛选交由 useEdgeAgents 客户端兜底 */
  async list(params: EdgeAgentsListParams = {}): Promise<ApiResponse<EdgeAgentsResponse>> {
    const res = await apiClient.get<AgentListResponse>(AGENTS_PATH, {
      params: { page: 1, page_size: 100, ...params },
    })
    const agents = (res.data?.list ?? []).map(toAgentView)
    return { ...res, data: { ...summarize(agents), agents } }
  },
  /**
   * 人工重启采集进程（契约 §3.2）：递增该节点 vm_agent_restart_seq 并留痕，节点约 30s 内
   * 随下次心跳执行幂等滚动重启（仅重启 vmagent 采集子进程，agent 本体与持久队列不受
   * 影响，队列数据不丢）。需 admin 权限；节点离线/退役时后端返回 400。
   */
  restart(id: number): Promise<ApiResponse<{ id: number; vm_agent_restart_seq?: number }>> {
    return apiClient.put(`${AGENTS_PATH}/${id}/restart`, {})
  },
  /**
   * 清空回传积压（契约 §3.2，破坏性操作）：递增该节点 flush_backlog_seq 并留痕，节点随
   * 下次心跳执行「停 vmagent → 删其持久队列目录（积压数据永久丢弃）→ 重新拉起」，
   * 换取回传通道实时性恢复。需 admin 权限；节点离线/退役时后端返回 400。
   */
  flushBacklog(id: number): Promise<ApiResponse<{ id: number; flush_backlog_seq?: number }>> {
    return apiClient.put(`${AGENTS_PATH}/${id}/flush-backlog`, {})
  },
}
