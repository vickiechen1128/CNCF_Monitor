/**
 * 平台管理 API（/api/v2/platform/...）
 * 覆盖 module-06 Track B 增量契约快照 §2 用户 / §2 登录日志 / §3 租户：
 * - 用户：GET/POST users、PUT/:id、PATCH/:id/status、PUT/:id/password
 * - 登录日志：GET /login-logs（分页 + username/success 筛选）
 * - 租户：GET /tenants、GET /tenants/:id、PUT /tenants/:id（MVP 无新建/禁用）
 * 统一使用契约 `{items, total}` 信封（区别于 domain.ts 旧 `{list,page,page_size}` 信封）。
 */
import { apiClient } from './client'
import type { ApiResponse } from '../types/api'
import type {
  ItemsResult,
  LoginLogItem,
  ResetPasswordInput,
  Tenant,
  TenantEditInput,
  UserCreateInput,
  UserItem,
  UserStatus,
  UserUpdateInput,
} from '../types/admin'

export interface UsersListParams extends Record<string, string | number | boolean | undefined> {
  username?: string
  status?: string
}

export interface LoginLogsListParams extends Record<string, string | number | boolean | undefined> {
  username?: string
  success?: string
  page?: number
  page_size?: number
}

/** 用户管理 */
export const userApi = {
  list(params?: UsersListParams): Promise<ApiResponse<ItemsResult<UserItem>>> {
    return apiClient.get<ItemsResult<UserItem>>('/api/v2/platform/users', { params })
  },
  create(input: UserCreateInput): Promise<ApiResponse<UserItem>> {
    return apiClient.post<UserItem>('/api/v2/platform/users', { body: input })
  },
  update(id: string, input: UserUpdateInput): Promise<ApiResponse<UserItem>> {
    return apiClient.put<UserItem>(`/api/v2/platform/users/${encodeURIComponent(id)}`, { body: input })
  },
  updateStatus(id: string, status: UserStatus): Promise<ApiResponse<UserItem>> {
    return apiClient.patch<UserItem>(`/api/v2/platform/users/${encodeURIComponent(id)}/status`, {
      body: { status },
    })
  },
  resetPassword(id: string, input: ResetPasswordInput): Promise<ApiResponse<null>> {
    return apiClient.put<null>(`/api/v2/platform/users/${encodeURIComponent(id)}/password`, { body: input })
  },
  remove(id: string): Promise<ApiResponse<null>> {
    return apiClient.delete<null>(`/api/v2/platform/users/${encodeURIComponent(id)}`)
  },
}

/** 登录日志 */
export const loginLogApi = {
  list(params?: LoginLogsListParams): Promise<ApiResponse<ItemsResult<LoginLogItem>>> {
    return apiClient.get<ItemsResult<LoginLogItem>>('/api/v2/platform/login-logs', { params })
  },
}

/** 租户管理 MVP 子集：仅查看/编辑（契约 §3，不开放新建/禁用） */
export const tenantAdminApi = {
  list(params?: { status?: string }): Promise<ApiResponse<ItemsResult<Tenant>>> {
    return apiClient.get<ItemsResult<Tenant>>('/api/v2/platform/tenants', { params })
  },
  get(id: string): Promise<ApiResponse<Tenant>> {
    return apiClient.get<Tenant>(`/api/v2/platform/tenants/${encodeURIComponent(id)}`)
  },
  update(id: string, input: TenantEditInput): Promise<ApiResponse<Tenant>> {
    return apiClient.put<Tenant>(`/api/v2/platform/tenants/${encodeURIComponent(id)}`, { body: input })
  },
}