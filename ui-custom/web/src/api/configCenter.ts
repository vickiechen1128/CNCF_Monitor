/**
 * Module_09 配置中心 API 客户端（/api/v2/platform/*）。
 * 权威契约：docs/05-execution-records/module-09/api-contract-snapshot.md。
 * 统一返回 `ApiResponse<T>`；错误类型按契约 errorType 由 `request` 抛出 `ApiError`。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  ConfigDeployment,
  ConfigDraft,
  ConfigVersion,
  MonitorDomainInput,
  NetworkDomain,
  PaginatedItems,
  ResetTokenResult,
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

/** 网域监控纳管 */
export const networkDomainMonitorApi = {
  list(params?: ConfigListParams): Promise<ApiResponse<PaginatedItems<NetworkDomain>>> {
    return apiClient.get<PaginatedItems<NetworkDomain>>('/api/v2/platform/network-domains', { params })
  },
  monitor(id: string, input: MonitorDomainInput): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.post<NetworkDomain>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}/monitor`, {
      body: input,
    })
  },
  update(id: string, input: MonitorDomainInput): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.put<NetworkDomain>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}/monitor`, {
      body: input,
    })
  },
  resetToken(id: string): Promise<ApiResponse<ResetTokenResult>> {
    return apiClient.post<ResetTokenResult>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}/reset-token`)
  },
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
  discard(change_no: string, discarded_by?: string): Promise<ApiResponse<ConfigDraft>> {
    return apiClient.post<ConfigDraft>(
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
}