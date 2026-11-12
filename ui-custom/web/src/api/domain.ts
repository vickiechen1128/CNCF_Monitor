/**
 * 域对象平台 API（/api/v3/platform/...）
 *
 * M06 行政字段由 M06 v3 写接口维护；网域列表/详情由 M09 承载 enriched 行政
 * + 运行态视图（D32/D34）。`view=admin` 返回启用/停用全量行政视角。
 * 统一返回 `ApiResponse<T>`；错误类型按契约 errorType 由 `request` 抛出 `ApiError`。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
export { isApiError } from './client'
import type {
  DomainStatus,
  NetworkDomain,
  NetworkDomainDeleteResult,
  NetworkDomainImpact,
  NetworkDomainStatusResult,
  OnboardingNetworkDomain,
  Tenant,
  ZoneType,
} from '../types/domain'

const DOMAINS_PATH = '/api/v3/platform/network-domains'

/** 分页与筛选查询参数（M09 契约 §2.2 / D34） */
export interface ListParams extends Record<string, string | number | boolean | undefined> {
  page?: number
  page_size?: number
  /** 默认纳管视角（enabled + edge）；admin 返回启用/停用全量 */
  view?: 'onboarding' | 'admin'
  status?: DomainStatus
  registration_status?: string
  zone_type?: string
  tenant_id?: string
  cloud_code?: string
  /** 网域名称/ID 模糊搜索（v3 参数名为 keyword） */
  keyword?: string
}

/** 网域列表 v3 信封（契约 §1.2） */
interface DomainListResponse {
  list?: OnboardingNetworkDomain[]
  total?: number
  page?: number
  page_size?: number
}

/** v3 enriched 网域视图 → 页面既有 NetworkDomain 模型 */
function toNetworkDomain(item: OnboardingNetworkDomain): NetworkDomain {
  return {
    id: item.network_domain_id,
    name: item.name,
    description: item.description ?? '',
    domain_type: item.domain_type,
    cloud_code: item.cloud_code || undefined,
    zone_type: item.zone_type ?? '',
    tenant_id: item.tenant_id ?? '',
    authorized_tenant_ids: item.authorized_tenant_ids ?? [],
    channel: 'agent_pull',
    center_endpoint: item.center_endpoint || undefined,
    remote_write_url: item.remote_write_url || undefined,
    token_masked: item.token_masked || undefined,
    is_monitored: item.registration_status === 'monitored',
    has_online_agents: (item.online_agent_count ?? 0) > 0,
    registration_status: item.registration_status,
    monitored_at: item.monitored_at,
    agent_count: item.agent_count,
    online_agent_count: item.online_agent_count,
    last_config_version: item.last_config_version || undefined,
    last_heartbeat: item.last_heartbeat_at ?? undefined,
    status: item.status,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }
}

/** 登记网域（行政信息）输入；tenant_id 固定 platform_admin（后端不信任客户端，不传） */
export interface NetworkDomainCreateInput {
  name: string
  /** 云归属（M06 §5.2，必填）：取自云字典启用条目（M07 §5.20），不开放自由文本 */
  cloud_code: string
  /** 网络分区（M06 §5.2，必填）：取自区域类型字典启用条目，不开放自由文本 */
  zone_type: string
  description?: string
  authorized_tenant_ids?: string[]
  /** 可选的自定义网域编码；留空由后端生成 */
  domain_code?: string
}

/**
 * 编辑网域（行政信息）输入；不含 tenant_id / cloud_code / domain_type（创建后不可变更）。
 */
export interface NetworkDomainUpdateInput {
  name?: string
  description?: string
  /** 网络分区（必填维护） */
  zone_type?: string
  authorized_tenant_ids?: string[]
}

/**
 * 区域类型字典（部署级只读，仅消费启用项做下拉）。
 * v3 契约：`GET /api/v3/platform/zone-types` 返回分页信封 `{list,total}`。
 */
export const zoneTypeApi = {
  async list(): Promise<ApiResponse<ZoneType[]>> {
    const res = await apiClient.get<{ list?: ZoneType[]; total?: number }>('/api/v3/platform/zone-types')
    return { ...res, data: res.data?.list ?? [] }
  },
}

/** 网域管理（行政字段，MVP 登记能力） */
export const networkDomainApi = {
  async list(params?: ListParams): Promise<ApiResponse<Paginated<NetworkDomain>>> {
    const res = await apiClient.get<DomainListResponse>(DOMAINS_PATH, { params })
    const data = res.data ?? {}
    return {
      ...res,
      data: {
        list: (data.list ?? []).map(toNetworkDomain),
        total: data.total ?? 0,
        page: data.page ?? 1,
        page_size: data.page_size ?? params?.page_size ?? 20,
      },
    }
  },
  async get(id: string): Promise<ApiResponse<NetworkDomain>> {
    const res = await apiClient.get<OnboardingNetworkDomain>(
      `${DOMAINS_PATH}/${encodeURIComponent(id)}`,
    )
    return { ...res, data: toNetworkDomain(res.data) }
  },
  create(input: NetworkDomainCreateInput): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.post<NetworkDomain>(DOMAINS_PATH, { body: input })
  },
  update(id: string, input: NetworkDomainUpdateInput): Promise<ApiResponse<NetworkDomain>> {
    return apiClient.put<NetworkDomain>(`${DOMAINS_PATH}/${encodeURIComponent(id)}`, {
      body: input,
    })
  },
  updateStatus(id: string, status: DomainStatus): Promise<ApiResponse<NetworkDomainStatusResult>> {
    return apiClient.patch<NetworkDomainStatusResult>(
      `${DOMAINS_PATH}/${encodeURIComponent(id)}/status`,
      { body: { status } },
    )
  },
  remove(id: string): Promise<ApiResponse<NetworkDomainDeleteResult>> {
    return apiClient.delete<NetworkDomainDeleteResult>(
      `${DOMAINS_PATH}/${encodeURIComponent(id)}`,
    )
  },
}

/**
 * 从 PATCH /:id/status 响应中解析影响范围。
 * v3 契约固定为 `data.impact`（ImpactResponse）。
 */
export function resolveNetworkDomainImpact(
  result: ApiResponse<NetworkDomainStatusResult | null>,
): NetworkDomainImpact | null {
  const data = result.data
  if (!data?.impact) return null
  return {
    ...data.impact,
    sample_resources: data.impact.sample_resources ?? [],
    has_online_agents: data.impact.has_online_agents ?? false,
    monitoring_available: data.impact.monitoring_available ?? false,
  }
}

/** 租户管理 */
export const tenantApi = {
  list(params?: ListParams): Promise<ApiResponse<Paginated<Tenant>>> {
    return apiClient.get<Paginated<Tenant>>('/api/v3/platform/tenants', { params })
  },
  get(id: string): Promise<ApiResponse<Tenant>> {
    return apiClient.get<Tenant>(`/api/v3/platform/tenants/${encodeURIComponent(id)}`)
  },
}
