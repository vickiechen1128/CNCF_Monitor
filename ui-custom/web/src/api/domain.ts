/**
 * 域对象平台 API（/api/v2/platform/...）
 *
 * 复用 `apiClient`，按 03_API_Standard 的 `/api/v2/platform/*` 平台能力契约
 * 提供类型化调用，返回 `ApiResponse<T>`。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
export { isApiError } from './client'
import type {
  DomainStatus,
  DomainType,
  NetworkDomain,
  NetworkDomainImpact,
  NetworkDomainStatusResult,
  Tenant,
  ZoneType,
} from '../types/domain'

/** 分页与筛选查询参数（Module_06 §6.2 / §11.1） */
export interface ListParams extends Record<string, string | number | boolean | undefined> {
  page?: number
  page_size?: number
  status?: string
  zone_type?: string
  tenant_id?: string
  name?: string
}

function list<T>(path: string, params?: ListParams): Promise<ApiResponse<Paginated<T>>> {
  return apiClient.get<Paginated<T>>(path, { params })
}

/** 登记网域（行政信息）输入；tenant_id 固定 platform_admin（后端不信任客户端，不传） */
export interface NetworkDomainCreateInput {
  name: string
  domain_type: DomainType
  zone_type?: string
  description?: string
  authorized_tenant_ids?: string[]
}

/** 编辑网域（行政信息）输入；不含 tenant_id（登记归属创建后不可变更，Module_06 §6.2） */
export interface NetworkDomainUpdateInput {
  name?: string
  description?: string
  zone_type?: string
  authorized_tenant_ids?: string[]
}

/**
 * 区域类型字典（部署级只读，仅消费启用项做下拉）。
 * 契约：`GET /api/v2/platform/zone-types` 返回**原始数组**（非分页信封）
 * `[{code, display_name, description}]`（Module_06 §9.2 / T06-02）。
 */
export const zoneTypeApi = {
  list(): Promise<ApiResponse<ZoneType[]>> {
    return apiClient.get<ZoneType[]>('/api/v2/platform/zone-types')
  },
  get(code: string): Promise<ApiResponse<ZoneType>> {
    return apiClient.get<ZoneType>(`/api/v2/platform/zone-types/${encodeURIComponent(code)}`)
  },
}

/** 网域管理（行政字段，MVP 登记能力） */
export const networkDomainApi = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<NetworkDomain>>> {
    return list<NetworkDomain>('/api/v2/platform/network-domains', params)
  },
  get(id: string): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.get<NetworkDomain>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}`)
  },
  create(input: NetworkDomainCreateInput): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.post<NetworkDomain>('/api/v2/platform/network-domains', { body: input })
  },
  update(id: string, input: NetworkDomainUpdateInput): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.put<NetworkDomain>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}`, {
      body: input,
    })
  },
  updateStatus(id: string, status: DomainStatus): Promise<ApiResponse<NetworkDomainStatusResult>> {
    return apiClient.patch<NetworkDomainStatusResult>(
      `/api/v2/platform/network-domains/${encodeURIComponent(id)}/status`,
      { body: { status } },
    )
  },
  remove(id: string): Promise<ApiResponse<null>> {
    return apiClient.delete<null>(`/api/v2/platform/network-domains/${encodeURIComponent(id)}`)
  },
}

/**
 * 从 PATCH /:id/status 响应中解析影响范围。
 * 契约兼容：影响范围可能嵌套在 `data.impact`，也可能直接平铺在 `data.{resource_count,...}`
 * （review 阶段按后端汇报的响应结构对齐——TaskDesc 用 edge_agent_count，L3/PRD 用 managed_edge_agent_count）。
 */
export function resolveNetworkDomainImpact(
  result: ApiResponse<NetworkDomainStatusResult | null>,
): NetworkDomainImpact | null {
  const data = result.data
  if (!data) return null
  if (data.impact) return data.impact
  const hasAny =
    data.resource_count !== undefined ||
    data.managed_edge_agent_count !== undefined ||
    data.edge_agent_count !== undefined
  if (!hasAny) return null
  return {
    resource_count: data.resource_count ?? 0,
    managed_edge_agent_count: data.managed_edge_agent_count ?? data.edge_agent_count ?? 0,
  }
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
