/**
 * Module_09 配置中心 API 客户端。
 *
 * 网域纳管与配置快照均走 v3 契约：
 * docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md §2 / §4。
 * v3 已删除草稿 / 配置版本 / 下发记录（含 confirm、revalidate、discard、rollback）端点，
 * 本模块不再暴露对应客户端方法。
 * 统一返回 `ApiResponse<T>`；错误类型按契约 errorType 由 `request` 抛出 `ApiError`。
 */
import { apiClient, ApiError, rawRequest } from './client'
import type { ApiResponse } from '../types/api'
import type {
  ConfigSnapshot,
  ConfigSnapshotListResponse,
  MonitoredStatus,
  MonitorDomainResult,
  NetworkDomain,
  OnboardingDomain,
  ResetTokenResult,
  UnmonitorDomainResult,
} from '../types/config-center'

/** M09 网域列表查询参数（snake_case + 分页） */
export interface ConfigListParams extends Record<string, string | number | boolean | undefined> {
  page?: number
  page_size?: number
  keyword?: string
}

const DOMAINS_PATH = '/api/v3/platform/network-domains'

/** v3 纳管列表信封（契约 §1.2） */
interface OnboardingListResponse {
  list?: OnboardingDomain[]
  total?: number
  page?: number
  page_size?: number
}

/**
 * 网域运行态：由节点聚合计数派生（v3 列表不再直接下发 monitored_status）。
 * 无节点 → unknown；全部在线 → normal；全部离线 → offline；其余 → partial。
 */
function deriveMonitoredStatus(item: OnboardingDomain): MonitoredStatus {
  if (!item.agent_count) return 'unknown'
  if (!item.online_agent_count) return 'offline'
  if (item.online_agent_count >= item.agent_count) return 'normal'
  return 'partial'
}

/**
 * v3 纳管视图 → 页面既有 NetworkDomain 模型（渠道固定 agent_pull：v3 列表只含启用中的采集节点域）。
 * 保留 v3 扩展字段供详情抽屉展示聚合信息。
 */
function toNetworkDomain(item: OnboardingDomain): NetworkDomain {
  return {
    id: item.network_domain_id,
    name: item.name,
    domain_type: 'edge',
    zone_type: item.zone_type || undefined,
    tenant_id: '',
    cloud_code: item.cloud_code || undefined,
    channel: 'agent_pull',
    agent_type: 'vmagent',
    center_endpoint: item.center_endpoint || undefined,
    remote_write_url: item.remote_write_url || undefined,
    token_masked: item.token_masked || undefined,
    is_monitored: item.registration_status === 'monitored',
    monitored_status: deriveMonitoredStatus(item),
    last_heartbeat: item.last_heartbeat_at ?? undefined,
    status: 'enabled',
    created_at: item.created_at,
    updated_at: item.updated_at,
    registration_status: item.registration_status,
    monitored_at: item.monitored_at,
    agent_count: item.agent_count,
    online_agent_count: item.online_agent_count,
    last_config_version: item.last_config_version || undefined,
  }
}

/**
 * 网域纳管（v3 契约 §2）。
 * 列表/详情返回 enriched 纳管视图并归一为页面模型；写操作由后端 RequireAdmin 兜底。
 */
export const networkDomainMonitorApi = {
  async list(params?: ConfigListParams): Promise<ApiResponse<OnboardingListResponse>> {
    return apiClient.get<OnboardingListResponse>(DOMAINS_PATH, { params })
  },
  async get(id: string): Promise<ApiResponse<NetworkDomain>> {
    const res = await apiClient.get<OnboardingDomain>(`${DOMAINS_PATH}/${encodeURIComponent(id)}`)
    return { ...res, data: toNetworkDomain(res.data) }
  },
  /** 纳管：签发 Token（明文仅本响应返回一次）并给出安装指引；无请求体（契约 §2.2） */
  monitor(id: string): Promise<ApiResponse<MonitorDomainResult>> {
    return apiClient.post<MonitorDomainResult>(`${DOMAINS_PATH}/${encodeURIComponent(id)}/monitor`)
  },
  /** 重置 Token：旧 Token 立即失效，返回新明文一次（契约 §2.4） */
  resetToken(id: string): Promise<ApiResponse<ResetTokenResult>> {
    return apiClient.post<ResetTokenResult>(`${DOMAINS_PATH}/${encodeURIComponent(id)}/token/reset`)
  },
  /** 退纳管：废止 Token、节点转 retired、状态归 created（契约 §2.2） */
  unmonitor(id: string): Promise<ApiResponse<UnmonitorDomainResult>> {
    return apiClient.delete<UnmonitorDomainResult>(`${DOMAINS_PATH}/${encodeURIComponent(id)}/monitor`)
  },
  /** 将 v3 列表归一为页面模型（供 Hook / 下拉直接消费） */
  toNetworkDomain,
}

/** 单网域快照集合路径（v3 契约 §4.2） */
function snapshotsPath(domainId: string): string {
  return `${DOMAINS_PATH}/${encodeURIComponent(domainId)}/config-snapshots`
}

/** 快照详情路径 */
function snapshotPath(domainId: string, snapshotId: number): string {
  return `${snapshotsPath(domainId)}/${snapshotId}`
}

/** 将非信封响应的错误转换为 ApiError（快照内容为原始文本，不走统一 JSON 信封） */
async function toRawApiError(res: Response): Promise<ApiError> {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      const json = (await res.json()) as { error?: string; message?: string; errorType?: string }
      return new ApiError(json.error || json.message || res.statusText, res.status, json.errorType)
    } catch {
      // 非 JSON 错误体，回退 statusText
    }
  }
  return new ApiError(res.statusText, res.status)
}

/**
 * 配置快照只读接口（v3 契约 §4.2）。
 * 无确认 / 重校 / 废弃 / 回滚动作；快照由系统在配置变更后自动生成。
 */
export const configSnapshotApi = {
  /** 该网域历史快照列表（最新在前，仅元数据） */
  list(domainId: string): Promise<ApiResponse<ConfigSnapshotListResponse>> {
    return apiClient.get<ConfigSnapshotListResponse>(snapshotsPath(domainId))
  },
  /** 快照详情（failed 快照含 validation_details） */
  get(domainId: string, snapshotId: number): Promise<ApiResponse<ConfigSnapshot>> {
    return apiClient.get<ConfigSnapshot>(snapshotPath(domainId, snapshotId))
  },
  /**
   * 快照内容下载（admin）：响应为原始配置文本，不是 `{status,data}` JSON 信封，
   * 因此走 `rawRequest`（client.ts 的认证 fetch 变体）读取文本；401 由 client 统一跳登录，
   * 403（非 admin）在这里转成 ApiError 供页面提示。
   */
  async content(domainId: string, snapshotId: number): Promise<string> {
    const res = await rawRequest(`${snapshotPath(domainId, snapshotId)}/content`, { method: 'GET' })
    if (!res.ok) throw await toRawApiError(res)
    return res.text()
  },
}
