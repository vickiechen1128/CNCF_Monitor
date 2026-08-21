/**
 * 域对象平台 API（/api/v2/platform/...）
 *
 * 复用 `apiClient`，按 03_API_Standard 的 `/api/v2/platform/*` 平台能力契约
 * 提供类型化调用，返回 `ApiResponse<T>`。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type { NetworkDomain, Tenant, ZoneType } from '../types/domain'

/** 分页查询参数（兼容 request 的 params 类型） */
export interface ListParams extends Record<string, string | number | boolean | undefined> {
  page?: number
  page_size?: number
}

function list<T>(path: string, params?: ListParams): Promise<ApiResponse<Paginated<T>>> {
  return apiClient.get<Paginated<T>>(path, { params })
}

/** 区域类型字典 */
export const zoneTypeApi = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<ZoneType>>> {
    return list<ZoneType>('/api/v2/platform/zone-types', params)
  },
  get(code: string): Promise<ApiResponse<ZoneType>> {
    return apiClient.get<ZoneType>(`/api/v2/platform/zone-types/${encodeURIComponent(code)}`)
  },
}

/** 网域管理 */
export const networkDomainApi = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<NetworkDomain>>> {
    return list<NetworkDomain>('/api/v2/platform/network-domains', params)
  },
  get(id: string): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.get<NetworkDomain>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}`)
  },
}

/** 租户管理 */
export const tenantApi = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<Tenant>>> {
    return list<Tenant>('/api/v2/platform/tenants', params)
  },
  get(id: string): Promise<ApiResponse<Tenant>> {
    return apiClient.get<Tenant>(`/api/v2/platform/tenants/${encodeURIComponent(id)}`)
  },
}