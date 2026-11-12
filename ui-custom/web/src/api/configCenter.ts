/**
 * Module_09 配置中心 API 客户端。
 *
 * 网域纳管走 v3 契约：docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md §2。
 * 配置草稿 / 版本 / 下发记录仍为旧线（v3 已删除 confirm/rollback，回收窗口内暂保留）。
 * 统一返回 `ApiResponse<T>`；错误类型按契约 errorType 由 `request` 抛出 `ApiError`。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  ConfigDeployment,
  ConfigDraft,
  ConfigVersion,
  DiscardImpact,
  MonitoredStatus,
  MonitorDomainResult,
  NetworkDomain,
  OnboardingDomain,
  PaginatedItems,
  ResetTokenResult,
  RollbackPreview,
  UnmonitorDomainResult,
} from '../types/config-center'

/** M09 列表查询参数（snake_case + 分页） */
export interface ConfigListParams extends Record<string, string | number | boolean | undefined> {
  page?: number
  page_size?: number
  network_domain_id?: string
  status?: string
  change_no?: string
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

/** 配置草稿（变更单） */
export const configDraftApi = {
  create(network_domain_id: string): Promise<ApiResponse<ConfigDraft>> {
    return apiClient.post<ConfigDraft>('/api/v2/platform/config/drafts', { body: { network_domain_id } })
  },
  list(params?: ConfigListParams): Promise<ApiResponse<PaginatedItems<ConfigDraft>>> {
    return apiClient.get<PaginatedItems<ConfigDraft>>('/api/v2/platform/config-drafts', { params })
  },
  get(change_no: string): Promise<ApiResponse<ConfigDraft>> {
    return apiClient.get<ConfigDraft>(
      `/api/v2/platform/config-drafts/${encodeURIComponent(change_no)}`,
    )
  },
  confirm(change_no: string, confirmed_by: string): Promise<ApiResponse<ConfigVersion>> {
    return apiClient.post<ConfigVersion>(
      `/api/v2/platform/config-drafts/${encodeURIComponent(change_no)}/confirm`,
      { body: { confirmed_by } },
    )
  },
  revalidate(change_no: string): Promise<ApiResponse<{ validation_status: string }>> {
    return apiClient.post<{ validation_status: string }>(
      `/api/v2/platform/config-drafts/${encodeURIComponent(change_no)}/revalidate`,
    )
  },
  /** 废弃影响预览（决策 43-7）：真正废弃前展示对 ScrapeJob 源数据的分类影响。 */
  discardImpact(change_no: string): Promise<ApiResponse<DiscardImpact>> {
    return apiClient.get<DiscardImpact>(
      `/api/v2/platform/config-drafts/${encodeURIComponent(change_no)}/discard-impact`,
    )
  },
  discard(change_no: string, discarded_by?: string): Promise<ApiResponse<{ draft: ConfigDraft; impact: DiscardImpact }>> {
    return apiClient.post<{ draft: ConfigDraft; impact: DiscardImpact }>(
      `/api/v2/platform/config-drafts/${encodeURIComponent(change_no)}/discard`,
      { body: discarded_by ? { discarded_by } : {} },
    )
  },
}

/** 配置版本与下发记录（config-version / deployment service） */
export const deploymentApi = {
  getConfigVersions(params?: ConfigListParams): Promise<ApiResponse<PaginatedItems<ConfigVersion>>> {
    return apiClient.get<PaginatedItems<ConfigVersion>>('/api/v2/platform/config-versions', { params })
  },
  getConfigVersion(id: string): Promise<ApiResponse<ConfigVersion>> {
    return apiClient.get<ConfigVersion>(
      `/api/v2/platform/config-versions/${encodeURIComponent(id)}`,
    )
  },
  list(params?: ConfigListParams): Promise<ApiResponse<PaginatedItems<ConfigDeployment>>> {
    return apiClient.get<PaginatedItems<ConfigDeployment>>('/api/v2/platform/deployments', { params })
  },
  retry(deployment_id: string, triggered_by: string): Promise<ApiResponse<ConfigDeployment>> {
    return apiClient.post<ConfigDeployment>(
      `/api/v2/platform/deployments/${encodeURIComponent(deployment_id)}/retry`,
      { body: { triggered_by } },
    )
  },
  rollback(config_version_id: string, triggered_by: string): Promise<ApiResponse<ConfigDeployment>> {
    return apiClient.post<ConfigDeployment>(
      `/api/v2/platform/deployments/${encodeURIComponent(config_version_id)}/rollback`,
      { body: { triggered_by } },
    )
  },
  /** 回滚预览（决策 63 P0）：回滚确认前展示目标版本与当前生效版本的源数据操作差异。 */
  rollbackPreview(config_version_id: string): Promise<ApiResponse<RollbackPreview>> {
    return apiClient.get<RollbackPreview>(
      `/api/v2/platform/config-versions/${encodeURIComponent(config_version_id)}/rollback-preview`,
    )
  },
}