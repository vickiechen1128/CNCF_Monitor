/**
 * 平台管理 API（/api/v3/platform/...）
 * 覆盖 M06 v3 契约：用户 / 登录日志 / 租户：
 * - 用户：GET/POST users、PUT/:id、PATCH/:id/status、PUT/:id/password
 * - 登录日志：GET /login-logs（分页 + username/success 筛选）
 * - 租户：GET /tenants、GET /tenants/:id、PUT /tenants/:id（MVP 无新建/禁用）
 * 列表统一使用 v3 分页信封 `{list, total, page, page_size}`（types/api 的 Paginated）。
 */
import { apiClient } from './client'
import type { ApiResponse, Paginated } from '../types/api'
import type {
  LoginLogItem,
  ResetPasswordInput,
  Tenant,
  TenantEditInput,
  UserCreateInput,
  UserItem,
  UserStatus,
  UserUpdateInput,
} from '../types/admin'

/**
 * 用户列表筛选参数（v3 handler 支持 status / role / keyword / page / page_size）。
 * 注意：v3 不支持 `username` 参数，用户名检索统一走 `keyword`。
 */
export interface UsersListParams extends Record<string, string | number | boolean | undefined> {
  keyword?: string
  role?: string
  status?: string
  page?: number
  page_size?: number
}

/** 登录日志列表筛选参数（v3 handler 支持 username / success / page / page_size） */
export interface LoginLogsListParams extends Record<string, string | number | boolean | undefined> {
  username?: string
  success?: string
  page?: number
  page_size?: number
}

/** 租户列表筛选参数（v3 handler 支持 status / keyword / page / page_size） */
export interface TenantsListParams extends Record<string, string | number | boolean | undefined> {
  status?: string
  keyword?: string
  page?: number
  page_size?: number
}

/** 用户管理 */
export const userApi = {
  list(params?: UsersListParams): Promise<ApiResponse<Paginated<UserItem>>> {
    return apiClient.get<Paginated<UserItem>>('/api/v3/platform/users', { params })
  },
  create(input: UserCreateInput): Promise<ApiResponse<UserItem>> {
    return apiClient.post<UserItem>('/api/v3/platform/users', { body: input })
  },
  update(id: string, input: UserUpdateInput): Promise<ApiResponse<UserItem>> {
    return apiClient.put<UserItem>(`/api/v3/platform/users/${encodeURIComponent(id)}`, { body: input })
  },
  updateStatus(id: string, status: UserStatus): Promise<ApiResponse<UserItem>> {
    return apiClient.patch<UserItem>(`/api/v3/platform/users/${encodeURIComponent(id)}/status`, {
      body: { status },
    })
  },
  resetPassword(id: string, input: ResetPasswordInput): Promise<ApiResponse<null>> {
    return apiClient.put<null>(`/api/v3/platform/users/${encodeURIComponent(id)}/password`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<null>> {
    return apiClient.delete<null>(`/api/v3/platform/users/${encodeURIComponent(id)}`)
  },
}

/** 登录日志 */
export const loginLogApi = {
  list(params?: LoginLogsListParams): Promise<ApiResponse<Paginated<LoginLogItem>>> {
    return apiClient.get<Paginated<LoginLogItem>>('/api/v3/platform/login-logs', { params })
  },
}

/** 租户管理 MVP 子集：仅查看/编辑（契约 §3，不开放新建/禁用） */
export const tenantAdminApi = {
  list(params?: TenantsListParams): Promise<ApiResponse<Paginated<Tenant>>> {
    return apiClient.get<Paginated<Tenant>>('/api/v3/platform/tenants', { params })
  },
  get(id: string): Promise<ApiResponse<Tenant>> {
    return apiClient.get<Tenant>(`/api/v3/platform/tenants/${encodeURIComponent(id)}`)
  },
  update(id: string, input: TenantEditInput): Promise<ApiResponse<Tenant>> {
    return apiClient.put<Tenant>(`/api/v3/platform/tenants/${encodeURIComponent(id)}`, { body: input })
  },
}
